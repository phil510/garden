import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAGE_PRESETS, isWatchKind } from '@garden/shared';
import type { SessionPlacement, SwarmRecord } from '@garden/shared';
import type { OverlayStage, OverlayState } from '../domain/overlay.js';
import type { DigestRecord, Watch } from '../domain/watches.js';

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  version: 1,
  tmuxNames: {},
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
  watches: [],
  digests: [],
  pipes: {},
};

function statePath(appDir: string): string {
  return join(appDir, 'state.json');
}

/** The slice of `Logger` this adapter needs, declared locally rather than imported —
 *  one adapter per external system, composed together only in main.ts. */
export interface StoreLogger {
  warn(message: string): void;
}

const presets: ReadonlySet<string> = new Set(STAGE_PRESETS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `layout` is deliberately absent: it is dockview's own opaque blob, and the only reader
 *  is its `fromJSON`. The rest of `stage` is spread and indexed unchecked on boot. */
function isOverlayStage(value: unknown): value is OverlayStage {
  if (!isRecord(value)) return false;
  const preset = value['preset'];
  const slots = value['slots'];
  return (
    typeof preset === 'string' &&
    presets.has(preset) &&
    Array.isArray(slots) &&
    slots.every((slot) => slot === null || typeof slot === 'string') &&
    typeof value['focusedSlot'] === 'number'
  );
}

function isSwarmRecord(value: unknown): value is SwarmRecord {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['archived'] === 'boolean'
  );
}

function isSwarms(value: unknown): value is readonly SwarmRecord[] {
  return Array.isArray(value) && value.every(isSwarmRecord);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isSessionPlacement(value: unknown): value is SessionPlacement {
  return isRecord(value) && isOptionalString(value['parent']) && isOptionalString(value['swarmId']);
}

function isPlacements(value: unknown): value is Readonly<Record<string, SessionPlacement>> {
  return isRecord(value) && Object.values(value).every(isSessionPlacement);
}

const watchStatuses: ReadonlySet<unknown> = new Set(['active', 'error', 'closed']);

const ITEM_LISTS = [
  'reviews',
  'issueComments',
  'reviewComments',
  'checkRuns',
  'statuses',
  'conflicts',
];

/** The envelope only: entries of `items` are written by this code and not checked one by one. */
function isDigestDetail(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['repo'] === 'string' &&
    typeof value['pr'] === 'number' &&
    typeof value['line'] === 'string' &&
    typeof value['createdAt'] === 'string' &&
    !Number.isNaN(Date.parse(value['createdAt'])) &&
    (value['replaces'] === null || typeof value['replaces'] === 'string') &&
    isRecord(value['atMint']) &&
    (value['closed'] === null || isRecord(value['closed'])) &&
    isRecord(value['items']) &&
    ITEM_LISTS.every((list) => Array.isArray((value['items'] as Record<string, unknown>)[list]))
  );
}

function isPendingDigest(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['line'] === 'string' &&
    typeof value['createdAt'] === 'number'
  );
}

function isDigestRecord(value: unknown): value is DigestRecord {
  return (
    isRecord(value) && typeof value['sessionId'] === 'string' && isDigestDetail(value['detail'])
  );
}

/** `cursor` is deliberately unchecked: the poller owns its shape and may change it. */
function isWatch(value: unknown): value is Watch {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['sessionId'] === 'string' &&
    typeof value['repo'] === 'string' &&
    typeof value['pr'] === 'number' &&
    Number.isInteger(value['pr']) &&
    Array.isArray(value['kinds']) &&
    value['kinds'].every(isWatchKind) &&
    typeof value['createdAt'] === 'number' &&
    'cursor' in value &&
    (value['pendingDigest'] === null || isPendingDigest(value['pendingDigest'])) &&
    watchStatuses.has(value['status']) &&
    (value['errorReason'] === undefined || typeof value['errorReason'] === 'string')
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Every field the rest of the server reads without checking. A file that parses as
 *  JSON but does not answer this shape is as unusable as one that does not parse.
 *  `swarms`/`placements`/`swarmOrder`/`collapsedSwarms`/`hideDeadSwarms` are the exception:
 *  absent is valid (a pre-#170/#187 `state.json` simply predates them, and losing its
 *  `tmuxNames`/`groups`/`stage` over fields it never had would be the actual loss), but
 *  present-and-malformed still fails the whole file, same as every other field here.
 *  `watches` follows that rule for the array itself; its entries are filtered one by one in
 *  `readOverlayState`. */
function isOverlayState(
  value: unknown,
): value is Record<string, unknown> &
  Pick<OverlayState, 'version' | 'tmuxNames' | 'groups' | 'stage'> {
  if (!isRecord(value)) return false;
  return (
    value['version'] === 1 &&
    isRecord(value['tmuxNames']) &&
    isRecord(value['groups']) &&
    isOverlayStage(value['stage']) &&
    (value['swarms'] === undefined || isSwarms(value['swarms'])) &&
    (value['placements'] === undefined || isPlacements(value['placements'])) &&
    (value['swarmOrder'] === undefined || isStringArray(value['swarmOrder'])) &&
    (value['collapsedSwarms'] === undefined || isStringArray(value['collapsedSwarms'])) &&
    (value['hideDeadSwarms'] === undefined || isStringArray(value['hideDeadSwarms'])) &&
    (value['watches'] === undefined || Array.isArray(value['watches'])) &&
    (value['digests'] === undefined || Array.isArray(value['digests']))
  );
}

/** The detail is a read-path extra; the pending digest line is what gets delivered. A malformed
 *  detail is stripped on its own so the watch, its cursor and its line survive. */
function withoutBadDetail(watch: Watch, path: string, logger: StoreLogger): Watch {
  const pending = watch.pendingDigest;
  if (pending === null || pending.detail === undefined || isDigestDetail(pending.detail))
    return watch;
  logger.warn(`dropping malformed digest detail in ${path}`);
  return {
    ...watch,
    pendingDigest: { id: pending.id, line: pending.line, createdAt: pending.createdAt },
  };
}

/** Watches are written often by an automated poller and their shape evolves, so one bad entry
 *  is dropped on its own: failing the whole file would fall back to defaults, and the next
 *  write would permanently lose every session's tmux name. */
function readWatches(value: unknown, path: string, logger: StoreLogger): readonly Watch[] {
  if (!Array.isArray(value)) return [];
  const watches: Watch[] = [];
  for (const entry of value) {
    if (isWatch(entry)) watches.push(withoutBadDetail(entry, path, logger));
    else logger.warn(`dropping malformed watch in ${path}`);
  }
  return watches;
}

/** Like watches, a bad entry is dropped on its own rather than failing the file. */
function readDigests(value: unknown, path: string, logger: StoreLogger): readonly DigestRecord[] {
  if (!Array.isArray(value)) return [];
  const digests: DigestRecord[] = [];
  for (const entry of value) {
    if (isDigestRecord(entry)) digests.push(entry);
    else logger.warn(`dropping malformed digest record in ${path}`);
  }
  return digests;
}

/** Like watches, a bad entry is dropped on its own rather than failing the file. */
function readPipes(
  value: unknown,
  path: string,
  logger: StoreLogger,
): Readonly<Record<string, number>> {
  if (!isRecord(value)) return {};
  const pipes: Record<string, number> = {};
  for (const [sessionId, at] of Object.entries(value)) {
    if (typeof at === 'number' && Number.isFinite(at)) pipes[sessionId] = at;
    else logger.warn(`dropping malformed pipe time for ${sessionId} in ${path}`);
  }
  return pipes;
}

/** A missing file means a fresh install. A file that is present but unreadable as an
 *  overlay is a loss worth reporting: `tmuxNames` maps session ids to the tmux names
 *  garden chose, and nothing can recompute it. */
export function readOverlayState(appDir: string, logger: StoreLogger): OverlayState {
  const path = statePath(appDir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_OVERLAY_STATE;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    logger.warn(`ignoring unparseable ${path}: ${(error as Error).message}`);
    return DEFAULT_OVERLAY_STATE;
  }
  if (!isOverlayState(parsed)) {
    logger.warn(`ignoring ${path}: not a version 1 overlay state`);
    return DEFAULT_OVERLAY_STATE;
  }
  return {
    version: 1,
    tmuxNames: parsed.tmuxNames,
    groups: parsed.groups,
    stage: parsed.stage,
    swarms: isSwarms(parsed['swarms']) ? parsed['swarms'] : [],
    placements: isPlacements(parsed['placements']) ? parsed['placements'] : {},
    swarmOrder: isStringArray(parsed['swarmOrder']) ? parsed['swarmOrder'] : [],
    collapsedSwarms: isStringArray(parsed['collapsedSwarms']) ? parsed['collapsedSwarms'] : [],
    hideDeadSwarms: isStringArray(parsed['hideDeadSwarms']) ? parsed['hideDeadSwarms'] : [],
    watches: readWatches(parsed['watches'], path, logger),
    digests: readDigests(parsed['digests'], path, logger),
    pipes: readPipes(parsed['pipes'], path, logger),
  };
}

/** Writes to a temp file beside the target and renames over it, so a concurrent
 *  reader sees either the previous state or the new one, never a half-written file. */
export function writeOverlayState(appDir: string, state: OverlayState): void {
  mkdirSync(appDir, { recursive: true });
  const path = statePath(appDir);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, path);
}
