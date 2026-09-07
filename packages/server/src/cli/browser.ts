import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CHROME_APP_PATH = '/Applications/Google Chrome.app';

export function chromeInstalled(exists: (path: string) => boolean = existsSync): boolean {
  return exists(CHROME_APP_PATH);
}

/** The `open` argv that launches Chrome as an app window at `url`. -n forces a new `open`
 *  launch so --args reaches Chrome; without it, an already-running Chrome is just activated
 *  and the args are silently dropped. */
export function chromeWindowArgs(url: string): readonly [command: string, args: string[]] {
  return ['open', ['-na', 'Google Chrome', '--args', `--app=${url}`]];
}

export async function openChromeWindow(url: string): Promise<void> {
  const [command, args] = chromeWindowArgs(url);
  await execFileAsync(command, args);
}
