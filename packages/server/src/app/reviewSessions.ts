import { normalizeRepo } from '../domain/watches.js';
import { NoLocalCloneError, ReviewNotFoundError } from './errors.js';
import type { ReviewStore } from './reviews.js';
import { createSession } from './sessions.js';
import type { SessionsDeps } from './sessions.js';

export interface ReviewSessions {
  /** The session for a review request: the linked one if there is one, even when it has since
   *  been killed, else a new one in the request's clone, linked before it is returned. */
  start(owner: string, name: string, number: number): Promise<{ sessionId: string }>;
}

export function createReviewSessions(
  deps: SessionsDeps & { readonly reviews: Pick<ReviewStore, 'item' | 'link'> },
): ReviewSessions {
  /** Concurrent starts for one request share a creation, so a double click makes one session. */
  const starting = new Map<string, Promise<string>>();

  return {
    async start(owner, name, number) {
      const repo = normalizeRepo(`${owner}/${name}`);
      if (repo === null) throw new ReviewNotFoundError(`no review request for ${owner}/${name}`);
      const key = `${repo}#${String(number)}`;
      const item = deps.reviews.item(key);
      if (item === undefined) throw new ReviewNotFoundError(`no review request ${key}`);
      if (item.sessionId !== null) return { sessionId: item.sessionId };
      const { clonePath } = item;
      if (clonePath === null) throw new NoLocalCloneError(`no local clone of ${repo}`);

      let creation = starting.get(key);
      if (creation === undefined) {
        creation = (async () => {
          try {
            const { id } = await createSession(deps, { cwd: clonePath });
            deps.reviews.link(key, id);
            return id;
          } finally {
            starting.delete(key);
          }
        })();
        starting.set(key, creation);
      }
      return { sessionId: await creation };
    },
  };
}
