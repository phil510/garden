import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CHROME_APP_PATH = '/Applications/Google Chrome.app';

export function chromeInstalled(exists: (path: string) => boolean = existsSync): boolean {
  return exists(CHROME_APP_PATH);
}

export async function openChromeWindow(url: string): Promise<void> {
  // -n forces a new `open` launch so --args reaches Chrome; without it, an already-running
  // Chrome is just activated and the args are silently dropped.
  await execFileAsync('open', ['-na', 'Google Chrome', '--args', `--app=${url}`]);
}
