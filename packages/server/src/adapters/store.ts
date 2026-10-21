import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_UI_STATE, STAGE_PRESETS, isWatchKind } from '@garden/shared';
import type { SessionPlacement, StagePreset, SwarmRecord, UiState } from '@garden/shared';
import type { OverlayState, PersistedAlert } from '../domain/overlay.js';
import type { DigestRecord, Watch } from '../domain/watches.js';

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  version: 2,
  tmuxNames: {},
  ui: DEFAULT_UI_STATE,
  watches: [],
  alerts: [],
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

function isStagePreset(value: unknown): value is StagePreset {
  return typeof value === 'string' && presets.has(value);
}

function isSlots(value: unknown): value is (string | null)[] {
  return Array.isArray(value) && value.every((slot) => slot === null || typeof slot === 'string');
}

function isSwarmRecord(value: unknown): value is SwarmRecord {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['archived'] === 'boolean'
  );
}

function isSwarms(value: unknown): value is SwarmRecord[] {
  return Array.isArray(value) && value.every(isSwarmRecord);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isSessionPlacement(value: unknown): value is SessionPlacement {
  return isRecord(value) && isOptionalString(value['parent']) && isOptionalString(value['swarmId']);
}

function isPlacements(value: unknown): value is Record<string, SessionPlacement> {
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
    (value['ignoredChecks'] === undefined || isStringArray(value['ignoredChecks'])) &&
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

/** The list fields hold entries that are filtered one by one in `readOverlayState`, so a
 *  list that is absent reads as empty (a `state.json` that predates it loses nothing), but one
 *  that is present and not an array fails the whole file. */
function hasWellFormedLists(value: Record<string, unknown>): boolean {
  return (
    (value['watches'] === undefined || Array.isArray(value['watches'])) &&
    (value['alerts'] === undefined || Array.isArray(value['alerts'])) &&
    (value['digests'] === undefined || Array.isArray(value['digests']))
  );
}

/** A guard per `UiState` key. Typed as a mapped type so a field added to `UiState` fails
 *  typecheck here until it has one. `layout` accepts anything: it is dockview's own opaque
 *  blob and the only reader is its `fromJSON`. */
const UI_GUARDS: { readonly [K in keyof UiState]: (value: unknown) => value is UiState[K] } = {
  groupOrder: isStringArray,
  pinnedRepos: isStringArray,
  collapsedRepos: isStringArray,
  hideDeadRepos: isStringArray,
  preset: isStagePreset,
  slots: isSlots,
  focusedSlot: (value): value is number => typeof value === 'number',
  layout: (value): value is unknown => value !== undefined,
  swarms: isSwarms,
  placements: isPlacements,
  swarmOrder: isStringArray,
  collapsedSwarms: isStringArray,
  hideDeadSwarms: isStringArray,
};

/** An absent key takes its default silently, so a field added later does not make every
 *  existing file lose its other contents. A present key that fails its guard is reported and
 *  takes the default too: failing the whole file would drop `tmuxNames` on the next write. */
function readUi(value: Record<string, unknown>, path: string, logger: StoreLogger): UiState {
  // A clone, not the shared default, so the result owns its arrays and records.
  const ui: Record<string, unknown> = { ...structuredClone(DEFAULT_UI_STATE) };
  for (const key of Object.keys(UI_GUARDS) as (keyof UiState)[]) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (UI_GUARDS[key](entry)) ui[key] = entry;
    else logger.warn(`ignoring invalid ui.${key} in ${path}`);
  }
  // Every key has either passed its guard or kept its default.
  return ui as unknown as UiState;
}

/** Version 1 flattened the UI state into a per-repo `groups` map and a `stage` record. */
interface V1Group {
  readonly pinned: boolean;
  readonly order: number;
  readonly collapsed: boolean;
  readonly hideDead: boolean;
}

interface V1Stage {
  readonly preset: StagePreset;
  readonly slots: (string | null)[];
  readonly focusedSlot: number;
  readonly layout?: unknown;
}

function isV1Group(value: unknown): value is V1Group {
  return (
    isRecord(value) &&
    typeof value['pinned'] === 'boolean' &&
    typeof value['order'] === 'number' &&
    typeof value['collapsed'] === 'boolean' &&
    typeof value['hideDead'] === 'boolean'
  );
}

function isV1Stage(value: unknown): value is V1Stage {
  return (
    isRecord(value) &&
    isStagePreset(value['preset']) &&
    isSlots(value['slots']) &&
    typeof value['focusedSlot'] === 'number'
  );
}

/** The v1 fields a v1 file must carry. The swarm fields are the exception: a pre-#170/#187
 *  file predates them, and losing its `tmuxNames`/`groups`/`stage` over fields it never had
 *  would be the actual loss. Present and malformed still fails the whole file. */
function isV1State(value: Record<string, unknown>): value is Record<string, unknown> & {
  groups: Record<string, V1Group>;
  stage: V1Stage;
} {
  return (
    isRecord(value['groups']) &&
    Object.values(value['groups']).every(isV1Group) &&
    isV1Stage(value['stage']) &&
    (value['swarms'] === undefined || isSwarms(value['swarms'])) &&
    (value['placements'] === undefined || isPlacements(value['placements'])) &&
    (value['swarmOrder'] === undefined || isStringArray(value['swarmOrder'])) &&
    (value['collapsedSwarms'] === undefined || isStringArray(value['collapsedSwarms'])) &&
    (value['hideDeadSwarms'] === undefined || isStringArray(value['hideDeadSwarms']))
  );
}

/** The `ui` a v2 file would hold, built from a validated v1 file: the per-repo `groups` map
 *  becomes the three repo lists plus their order, and the stage's fields sit beside them. */
function liftV1Ui(
  value: Record<string, unknown> & { groups: Record<string, V1Group>; stage: V1Stage },
): Record<string, unknown> {
  const entries = Object.entries(value.groups).sort((a, b) => a[1].order - b[1].order);
  const where = (flag: 'pinned' | 'collapsed' | 'hideDead') =>
    entries.filter(([, group]) => group[flag]).map(([repo]) => repo);
  return {
    groupOrder: entries.map(([repo]) => repo),
    pinnedRepos: where('pinned'),
    collapsedRepos: where('collapsed'),
    hideDeadRepos: where('hideDead'),
    preset: value.stage.preset,
    slots: value.stage.slots,
    focusedSlot: value.stage.focusedSlot,
    layout: value.stage.layout,
    swarms: value['swarms'],
    placements: value['placements'],
    swarmOrder: value['swarmOrder'],
    collapsedSwarms: value['collapsedSwarms'],
    hideDeadSwarms: value['hideDeadSwarms'],
  };
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

function isPersistedAlert(value: unknown): value is PersistedAlert {
  return (
    isRecord(value) &&
    typeof value['sessionId'] === 'string' &&
    typeof value['text'] === 'string' &&
    typeof value['raisedAt'] === 'number' &&
    typeof value['updatedAt'] === 'number'
  );
}

/** Like watches, a bad entry is dropped on its own rather than failing the file. */
function readAlerts(value: unknown, path: string, logger: StoreLogger): readonly PersistedAlert[] {
  if (!Array.isArray(value)) return [];
  const alerts: PersistedAlert[] = [];
  for (const entry of value) {
    if (isPersistedAlert(entry)) alerts.push(entry);
    else logger.warn(`dropping malformed alert in ${path}`);
  }
  return alerts;
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

/** `undefined` when the file's UI part is unusable: an unknown version, a v1 file with a bad
 *  stage or group, a v2 file with no `ui` object. */
function readStoredUi(
  parsed: Record<string, unknown>,
  path: string,
  logger: StoreLogger,
): UiState | undefined {
  if (parsed['version'] === 1)
    return isV1State(parsed) ? readUi(liftV1Ui(parsed), path, logger) : undefined;
  if (parsed['version'] === 2)
    return isRecord(parsed['ui']) ? readUi(parsed['ui'], path, logger) : undefined;
  return undefined;
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
  const ui =
    isRecord(parsed) && isRecord(parsed['tmuxNames']) && hasWellFormedLists(parsed)
      ? readStoredUi(parsed, path, logger)
      : undefined;
  if (!isRecord(parsed) || ui === undefined) {
    logger.warn(`ignoring ${path}: not a version 1 or 2 overlay state`);
    return DEFAULT_OVERLAY_STATE;
  }
  return {
    version: 2,
    tmuxNames: parsed['tmuxNames'] as Record<string, string>,
    ui,
    watches: readWatches(parsed['watches'], path, logger),
    alerts: readAlerts(parsed['alerts'], path, logger),
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
