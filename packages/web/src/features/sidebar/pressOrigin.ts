/** Whether a mousedown landed inside the currently open context menu — the one thing that
 *  distinguishes a drag-released press (starts on a menu item, releases on the row body) from
 *  an ordinary click, since the browser routes that mismatched press/release pair to their
 *  common ancestor rather than to either endpoint. */
export function pressStartedInMenu(target: { closest(selector: string): unknown } | null): boolean {
  return target !== null && target.closest('.context-menu') !== null;
}
