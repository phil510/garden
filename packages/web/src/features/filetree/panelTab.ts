import type { FilePanelTab } from '../../state/filePanelPersistence';

/** A tab choice held in component state rather than persisted, tied to the root it was made for. */
export interface TabOverride {
  root: string | null;
  tab: FilePanelTab;
}

/** The tab to show: a non-persisted override made for this root, else the root's stored tab
 *  ('files' when there is none). */
export function effectiveTab(
  override: TabOverride | null,
  root: string | null,
  persisted: FilePanelTab | undefined,
): FilePanelTab {
  if (override !== null && override.root === root) return override.tab;
  return persisted ?? 'files';
}
