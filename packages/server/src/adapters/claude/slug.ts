/**
 * Encodes a project directory's absolute path into the slug Claude Code uses for its
 * `~/.claude/projects/<slug>` directory: `/`, `.` and `_` each become `-`; an existing `-`,
 * digits, and case pass through unchanged. The mapping is lossy and not invertible
 * (`dbt_snowflake` collides with `dbt-snowflake`) — never reconstruct a path from a slug.
 */
export function slugify(path: string): string {
  return path.replace(/[/._]/g, '-');
}

/**
 * Keeps only the project directory names that live under one of the configured roots, so the
 * rest of the corpus never gets opened. A directory is in scope when its slug is a configured
 * root's slug itself or that slug followed by a path separator, never a bare string prefix —
 * a root slug ending in `-Extend` must not also match a sibling directory slugified from
 * `-Extend2`.
 */
export function inScopeDirs(dirNames: readonly string[], roots: readonly string[]): string[] {
  const rootSlugs = roots.map(slugify);
  return dirNames.filter((dir) =>
    rootSlugs.some((root) => dir === root || dir.startsWith(`${root}-`)),
  );
}
