export class SessionNotFoundError extends Error {}

/** No `owner/name` could be settled for a watch: none was given and the session's cwd has no
 *  usable GitHub `origin`, or the one given is not a valid repo name. */
export class RepoUnresolvedError extends Error {}

export class WatchNotFoundError extends Error {}

/** A PR number given without a repo matches watches in more than one repo. */
export class AmbiguousWatchError extends Error {}

/** No archived digest has this id: it expired, was never recorded, or predates details. */
export class DigestNotFoundError extends Error {}
