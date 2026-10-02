import type { RepoEntry } from '@garden/shared';
import { mostSpecificEntry } from '../features/filetree/projectPaths';

export type FilePanelTab = 'files' | 'editor';

export interface PersistedRootState {
  /** Root-relative directory paths. */
  expanded: string[];
  /** Root-relative file path. */
  openFile: string | null;
  tab: FilePanelTab;
}

/** What survives a reload; `byRoot` keys and `root` are `RepoEntry.path` values. A shape change
 *  bumps the storage key's version rather than migrating. */
export interface PersistedFilePanel {
  root: string | null;
  byRoot: Record<string, PersistedRootState>;
}

export const FILE_PANEL_STORAGE_KEY = 'garden.filePanel.v1';

export function defaultFilePanel(): PersistedFilePanel {
  return { root: null, byRoot: {} };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isRootState(value: unknown): value is PersistedRootState {
  return (
    isRecord(value) &&
    Array.isArray(value.expanded) &&
    value.expanded.every((path) => typeof path === 'string') &&
    (value.openFile === null || typeof value.openFile === 'string') &&
    (value.tab === 'files' || value.tab === 'editor')
  );
}

function isPersistedFilePanel(value: unknown): value is PersistedFilePanel {
  return (
    isRecord(value) &&
    (value.root === null || typeof value.root === 'string') &&
    isRecord(value.byRoot) &&
    Object.values(value.byRoot).every(isRootState)
  );
}

/** Strict whole-value validation: anything unreadable or off-shape is discarded, never merged.
 *  Unknown extra fields are tolerated and dropped. */
export function parseFilePanel(raw: string | null): PersistedFilePanel {
  if (raw === null) return defaultFilePanel();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedFilePanel(parsed)) return defaultFilePanel();
    // Rebuilt rather than returned so a field this version no longer has (`showGitignored`) is
    // dropped instead of being written back on the next save.
    return { root: parsed.root, byRoot: parsed.byRoot };
  } catch {
    return defaultFilePanel();
  }
}

/** The persisted root if still listed, else the focused session's project, else the first entry. */
export function chooseStartupRoot(
  persistedRoot: string | null,
  repos: readonly RepoEntry[],
  focusedCwd: string | null,
): string | null {
  if (persistedRoot !== null && repos.some((repo) => repo.path === persistedRoot)) {
    return persistedRoot;
  }
  const jump = focusedCwd === null ? null : mostSpecificEntry(repos, focusedCwd);
  return jump?.path ?? repos[0]?.path ?? null;
}
