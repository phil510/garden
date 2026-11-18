import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CodexEndpoint {
  version: 1;
  generation: string;
  endpoint: string;
  pid: number;
}

export function codexEndpointPath(appDir: string, id: string): string {
  if (!/^[a-z0-9_-]{1,128}$/i.test(id)) throw new Error('invalid Codex session id');
  return join(appDir, 'native-endpoints', `${id}.json`);
}

export function readCodexEndpoint(appDir: string, id: string): CodexEndpoint | null {
  try {
    const value = JSON.parse(readFileSync(codexEndpointPath(appDir, id), 'utf8')) as CodexEndpoint;
    if (
      value.version !== 1 ||
      typeof value.generation !== 'string' ||
      typeof value.endpoint !== 'string' ||
      !value.endpoint.startsWith('unix:///') ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0
    )
      return null;
    process.kill(value.pid, 0);
    return value;
  } catch {
    return null;
  }
}

export function codexLauncherCommand(options: {
  appDir: string;
  id: string;
  cwd: string;
  backendCommand: readonly string[];
  terminalCommand: readonly string[];
}): readonly string[] {
  const descriptor = codexEndpointPath(options.appDir, options.id);
  mkdirSync(join(options.appDir, 'native-endpoints'), { recursive: true, mode: 0o700 });
  const script = join(options.appDir, 'codex-launcher.cjs');
  const temporary = `${script}.${randomUUID()}.tmp`;
  writeFileSync(temporary, LAUNCHER_SCRIPT, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, script);
  // /tmp avoids macOS's long per-user temporary paths and sockaddr_un's length limit.
  const socketDir = `/tmp/garden-codex-${process.getuid?.() ?? 'user'}-${createHash('sha256').update(descriptor).digest('hex').slice(0, 20)}`;
  return [process.execPath, script, JSON.stringify({ ...options, descriptor, socketDir })];
}

// tmux owns this process. No connection to Garden controls either child's lifetime.
const LAUNCHER_SCRIPT = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const options = JSON.parse(process.argv[2]);
const generation = randomUUID();
const socketPath = path.join(options.socketDir, generation + '.sock');
const endpoint = 'unix://' + socketPath;
const shutdownGraceMs = 1500;
let backend, terminal, probe, readyTimer, retryTimer, killTimer;
let stopping = false;
let groupKilled = false;
let exitCode = 1;
function alive(child) { return child && child.pid && child.exitCode === null && child.signalCode === null; }
function clean() {
  try { fs.unlinkSync(socketPath); } catch {}
  try { fs.rmdirSync(options.socketDir); } catch {}
  try {
    const current = JSON.parse(fs.readFileSync(options.descriptor, 'utf8'));
    if (current.generation === generation) fs.unlinkSync(options.descriptor);
  } catch {}
}
function backendGroupAlive() {
  if (!backend || !backend.pid || groupKilled) return false;
  try { process.kill(-backend.pid, 0); return true; } catch { return false; }
}
function signal(child, value, group) {
  if (group ? !backendGroupAlive() : !alive(child)) return;
  try { if (group) process.kill(-child.pid, value); else child.kill(value); } catch {}
}
function finish() {
  if (!stopping || alive(backend) || alive(terminal) || backendGroupAlive()) return;
  clearTimeout(killTimer);
  process.exit(exitCode);
}
function stop(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  clearTimeout(readyTimer);
  clearTimeout(retryTimer);
  if (probe) probe.destroy();
  signal(terminal, 'SIGTERM', false);
  signal(backend, 'SIGTERM', true);
  killTimer = setTimeout(() => {
    signal(terminal, 'SIGKILL', false);
    signal(backend, 'SIGKILL', true);
    groupKilled = true;
    finish();
  }, shutdownGraceMs);
  finish();
}
process.on('SIGHUP', () => stop(129));
process.on('SIGTERM', () => stop(143));
// The terminal shares the foreground process group and receives Ctrl-C itself.
process.on('SIGINT', () => {});
function fail(error) {
  console.error('Garden Codex launcher: ' + error.message);
  stop(1);
}
function startTerminal() {
  if (stopping) return;
  clearTimeout(readyTimer);
  const temporary = options.descriptor + '.' + generation + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({version:1,generation,endpoint,pid:process.pid}), {mode:0o600,flag:'wx'});
  fs.renameSync(temporary, options.descriptor);
  terminal = spawn(options.terminalCommand[0], [...options.terminalCommand.slice(1), '--remote', endpoint, '--cd', options.cwd], {cwd:options.cwd,stdio:'inherit'});
  terminal.once('error', fail);
  terminal.once('exit', code => { stop(code ?? 1); finish(); });
}
function checkReady() {
  if (stopping) return;
  probe = net.createConnection(socketPath);
  probe.once('connect', () => {
    probe.destroy();
    try { startTerminal(); } catch (error) { fail(error); }
  });
  probe.once('error', () => {
    if (!stopping) retryTimer = setTimeout(checkReady, 30);
  });
}
function readPreviousLauncher() {
  try { return JSON.parse(fs.readFileSync(options.descriptor, 'utf8')); } catch { return null; }
}

function launcherAlive(launcher) {
  const pid = launcher?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForPreviousLauncher() {
  const previous = readPreviousLauncher();
  if (!launcherAlive(previous)) return previous;

  // tmux can start the replacement while the old launcher is still reaping its children.
  const deadline = Date.now() + shutdownGraceMs + 1000;
  while (Date.now() < deadline && launcherAlive(previous)) await delay(30);
  const current = readPreviousLauncher();
  if (launcherAlive(previous) || launcherAlive(current)) {
    throw new Error('Codex session already has a live launcher');
  }
  return current;
}

async function start() {
  const previous = await waitForPreviousLauncher();
  try {
    fs.mkdirSync(options.socketDir, {mode:0o700});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = fs.lstatSync(options.socketDir);
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('unsafe Codex socket directory');
  }
  process.on('exit', clean);
  const previousPath = typeof previous?.endpoint === 'string' ? previous.endpoint.replace(/^unix:\/\//, '') : '';
  if (path.dirname(previousPath) === options.socketDir) {
    try { fs.unlinkSync(previousPath); } catch {}
  }
  const log = fs.openSync(path.join(path.dirname(options.descriptor), path.basename(options.descriptor, '.json') + '.log'), 'a', 0o600);
  try {
    backend = spawn(options.backendCommand[0], [...options.backendCommand.slice(1), '--listen', endpoint], {cwd:options.cwd,stdio:['ignore',log,log],detached:true,env:{...process.env,GARDEN_CODEX_GENERATION:generation}});
  } finally {
    fs.closeSync(log);
  }
  backend.once('error', fail);
  backend.once('exit', code => { stop(code === 0 ? 1 : code ?? 1); finish(); });
  readyTimer = setTimeout(() => fail(new Error('app-server did not become ready within 10 seconds')), 10000);
  checkReady();
}
start().catch(fail);
`;
