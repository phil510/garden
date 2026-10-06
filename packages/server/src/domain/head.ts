const BRANCH_REF = 'ref: refs/heads/';
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * What `git rev-parse --abbrev-ref HEAD` would print, read straight from the contents of a
 * `HEAD` file; null when the file says something only git can interpret. A branch that is
 * unborn still has a name here, and one sharing its name with a tag is its bare name rather
 * than `heads/<name>` — git's disambiguation needs the ref database, which this does not have.
 * reftable repositories write `ref: refs/heads/.invalid` as a placeholder, and a symbolic ref
 * outside `refs/heads/` has no branch name to give; both are left to git.
 */
export function parseHead(contents: string): string | null {
  const line = contents.replace(/\r?\n$/, '');
  if (OBJECT_ID.test(line)) return 'HEAD';
  if (!line.startsWith(BRANCH_REF)) return null;
  const name = line.slice(BRANCH_REF.length);
  if (name === '' || name === '.invalid' || name.includes('\n')) return null;
  return name;
}
