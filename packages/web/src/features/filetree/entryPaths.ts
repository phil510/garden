/** The two copyable forms of a tree entry's path: absolute under the panel's root, and the
 *  root-relative `entry.path` as listed by the server. */
export function entryPaths(
  root: string,
  entryPath: string,
): { absolute: string; relative: string } {
  return { absolute: `${root}/${entryPath}`, relative: entryPath };
}
