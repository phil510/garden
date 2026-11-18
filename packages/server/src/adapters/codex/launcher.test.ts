import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { codexLauncherCommand, readCodexEndpoint } from './launcher.js'

const directories: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
  }
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function waitFor<T>(read: () => T, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    const value = read()
    if (accept(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('condition did not become true')
}

function setup(backend = '') {
  const appDir = mkdtempSync(join(tmpdir(), 'codex-launcher-'))
  directories.push(appDir)
  const fake = join(appDir, 'fake.cjs')
  writeFileSync(
    fake,
    `
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const mode = process.argv[2];
fs.writeFileSync(path.join(__dirname, mode + '.json'), JSON.stringify({pid:process.pid,args:process.argv.slice(3),home:process.env.CODEX_HOME}));
if (mode === 'backend') {
  ${backend}
  const server = net.createServer(socket => socket.end());
  server.listen(process.argv[process.argv.indexOf('--listen') + 1].replace('unix://', ''));
} else setInterval(() => {}, 1000);
`,
  )
  const command = codexLauncherCommand({
    appDir,
    id: 'test',
    cwd: appDir,
    backendCommand: [process.execPath, fake, 'backend'],
    terminalCommand: [process.execPath, fake, 'terminal', "literal ' $() argument"],
  })
  function launch() {
    const child = spawn(command[0]!, command.slice(1), {
      stdio: 'ignore',
      env: { ...process.env, CODEX_HOME: join(appDir, 'native-home') },
    })
    children.push(child)
    return child
  }
  function info(mode: string): { pid: number; args: string[]; home: string } | null {
    try {
      return JSON.parse(readFileSync(join(appDir, `${mode}.json`), 'utf8')) as {
        pid: number
        args: string[]
        home: string
      }
    } catch {
      return null
    }
  }
  return { appDir, launch, info, command }
}

function dead(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

describe('Codex session launcher', () => {
  it('starts a private backend and literal remote TUI with inherited Codex home', async () => {
    const fixture = setup()
    const child = fixture.launch()
    const tui = await waitFor(() => fixture.info('terminal'), Boolean)
    const descriptor = readCodexEndpoint(fixture.appDir, 'test')!
    expect(descriptor.pid).toBe(child.pid)
    expect(tui?.args).toEqual([
      "literal ' $() argument",
      '--remote',
      descriptor.endpoint,
      '--cd',
      fixture.appDir,
    ])
    expect(tui?.home).toBe(join(fixture.appDir, 'native-home'))
    expect(fixture.info('backend')?.home).toBe(tui?.home)
    expect(Buffer.byteLength(descriptor.endpoint.replace('unix://', ''))).toBeLessThan(104)
    const backendPid = fixture.info('backend')!.pid
    const exited = once(child, 'exit')
    process.kill(tui!.pid, 'SIGTERM')
    await exited
    expect(dead(backendPid)).toBe(true)
    expect(readCodexEndpoint(fixture.appDir, 'test')).toBeNull()
  })

  it('stops the terminal when its backend dies', async () => {
    const fixture = setup()
    const child = fixture.launch()
    const tui = await waitFor(() => fixture.info('terminal'), Boolean)
    const exited = once(child, 'exit')
    process.kill(fixture.info('backend')!.pid, 'SIGKILL')
    await exited
    expect(dead(tui!.pid)).toBe(true)
  })

  it('cleans up on hangup before backend readiness', async () => {
    const fixture = setup('setInterval(() => {}, 1000); return;')
    const child = fixture.launch()
    const backend = await waitFor(() => fixture.info('backend'), Boolean)
    const exited = once(child, 'exit')
    child.kill('SIGHUP')
    await exited
    expect(dead(backend!.pid)).toBe(true)
    expect(fixture.info('terminal')).toBeNull()
    expect(readCodexEndpoint(fixture.appDir, 'test')).toBeNull()
  })

  it('does not replace or stop an already running session', async () => {
    const fixture = setup()
    fixture.launch()
    await waitFor(() => fixture.info('terminal'), Boolean)
    const descriptor = readCodexEndpoint(fixture.appDir, 'test')
    const duplicate = fixture.launch()
    const [code] = (await once(duplicate, 'exit')) as [number]
    expect(code).toBe(1)
    expect(readCodexEndpoint(fixture.appDir, 'test')).toEqual(descriptor)
    expect(dead(fixture.info('backend')!.pid)).toBe(false)
  })

  it('survives the process that assembled and launched its command', async () => {
    const fixture = setup()
    const starter = spawn(
      process.execPath,
      [
        '-e',
        `
      const {spawn} = require('node:child_process');
      const command = JSON.parse(process.argv[1]);
      spawn(command[0], command.slice(1), {stdio:'ignore',detached:true}).unref();
    `,
        JSON.stringify(fixture.command),
      ],
      { stdio: 'ignore' },
    )
    await once(starter, 'exit')
    const tui = await waitFor(() => fixture.info('terminal'), Boolean)
    const descriptor = readCodexEndpoint(fixture.appDir, 'test')!
    try {
      expect(dead(descriptor.pid)).toBe(false)
      expect(dead(tui!.pid)).toBe(false)
    } finally {
      process.kill(descriptor.pid, 'SIGTERM')
      await waitFor(
        () => readCodexEndpoint(fixture.appDir, 'test'),
        (value) => value === null,
      )
    }
    expect(dead(tui!.pid)).toBe(true)
    expect(dead(fixture.info('backend')!.pid)).toBe(true)
  })

  it('fails promptly when the backend cannot start', async () => {
    const fixture = setup('process.exit(17);')
    const child = fixture.launch()
    const [code] = (await once(child, 'exit')) as [number]
    expect(code).toBe(17)
    expect(fixture.info('terminal')).toBeNull()
  })

  it('bounds backend readiness and reaps a backend that never listens', async () => {
    const fixture = setup('setInterval(() => {}, 1000); return;')
    const child = fixture.launch()
    const [code] = (await once(child, 'exit')) as [number]
    expect(code).toBe(1)
    expect(dead(fixture.info('backend')!.pid)).toBe(true)
    expect(fixture.info('terminal')).toBeNull()
  }, 15000)

  it.each(['launcher shutdown', 'backend death'])(
    'reaps a stubborn backend descendant after %s',
    async (cause) => {
      const fixture = setup(`
      require('node:child_process').spawn(process.execPath, ['-e', \`
        process.on('SIGTERM', () => {});
        require('node:fs').writeFileSync(process.argv[1], JSON.stringify({pid:process.pid}));
        setInterval(() => {}, 1000);
      \`, path.join(__dirname, 'descendant.json')], {stdio:'ignore'});
    `)
      const child = fixture.launch()
      await waitFor(() => fixture.info('terminal'), Boolean)
      const descendant = await waitFor(() => fixture.info('descendant'), Boolean)
      try {
        const exited = once(child, 'exit')
        if (cause === 'launcher shutdown') child.kill('SIGTERM')
        else process.kill(fixture.info('backend')!.pid, 'SIGKILL')
        await exited
        await waitFor(() => dead(descendant!.pid), Boolean)
      } finally {
        if (!dead(descendant!.pid)) process.kill(descendant!.pid, 'SIGKILL')
      }
    },
  )
})
