import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAGE_PRESETS } from '@garden/shared';
import type { SessionPlacement, SwarmRecord } from '@garden/shared';
import type { OverlayStage, OverlayState } from '../domain/overlay.js';

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
  return (
    isRecord(value) &&
    isOptionalString(value['parent']) &&
    isOptionalString(value['swarmId']) &&
    isOptionalString(value['successor'])
  );
}

function isPlacements(value: unknown): value is Readonly<Record<string, SessionPlacement>> {
  return isRecord(value) && Object.values(value).every(isSessionPlacement);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Every field the rest of the server reads without checking. A file that parses as
 *  JSON but does not answer this shape is as unusable as one that does not parse.
 *  `swarms`/`placements`/`swarmOrder`/`collapsedSwarms`/`hideDeadSwarms` are the exception:
 *  absent is valid (a pre-#170/#187 `state.json` simply predates them, and losing its
 *  `tmuxNames`/`groups`/`stage` over fields it never had would be the actual loss), but
 *  present-and-malformed still fails the whole file, same as every other field here. */
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
    (value['hideDeadSwarms'] === undefined || isStringArray(value['hideDeadSwarms']))
  );
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
