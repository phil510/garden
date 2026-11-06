import type { DismissReviewFailure } from '@garden/shared';
import { dismissFailure, stillRequested } from '../domain/reviews.js';
import { normalizeRepo } from '../domain/watches.js';
import type { PollerLogger } from './poller.js';
import type { GhPort } from './ports.js';
import type { ReviewStore } from './reviews.js';

export type DismissReviewOutcome =
  | { readonly kind: 'dismissed' }
  | { readonly kind: 'invalid-repo' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly failure: DismissReviewFailure };

export interface ReviewDismisserDeps {
  readonly gh: Pick<GhPort, 'get' | 'removeReviewRequest'>;
  readonly store: Pick<ReviewStore, 'queue' | 'dismiss'>;
  readonly logger: Pick<PollerLogger, 'error'>;
}

export interface ReviewDismisser {
  /** Removes the user's review request on GitHub, then the item from the queue. `repo` is the
   *  `owner/name` as the caller spelled it. The queue is left alone unless GitHub confirms the removal. */
  dismiss(repo: string, number: number): Promise<DismissReviewOutcome>;
}

const failed = (failure: DismissReviewFailure): DismissReviewOutcome => ({
  kind: 'failed',
  failure,
});

export function createReviewDismisser(deps: ReviewDismisserDeps): ReviewDismisser {
  const { gh, store, logger } = deps;
  // Cached for the server's life; only a successful lookup is kept.
  let login: string | null = null;

  async function currentLogin(): Promise<string | DismissReviewFailure> {
    if (login !== null) return login;
    const result = await gh.get('user', null);
    if (result.kind === 'unavailable' || result.kind === 'rate-limited')
      return dismissFailure(result);
    const body = result.kind === 'ok' ? result.body : null;
    const found =
      typeof body === 'object' && body !== null ? (body as { login?: unknown }).login : null;
    // No status here: one on a `/user` failure would read as GitHub refusing the dismiss.
    if (typeof found !== 'string' || found === '') return { kind: 'error' };
    login = found;
    return found;
  }

  return {
    async dismiss(spelling, number) {
      const repo = normalizeRepo(spelling);
      if (repo === null) return { kind: 'invalid-repo' };
      const key = `${repo}#${String(number)}`;
      if (!store.queue().items.some((item) => item.key === key)) return { kind: 'not-found' };
      try {
        const who = await currentLogin();
        if (typeof who !== 'string') return failed(who);
        const result = await gh.removeReviewRequest(repo, number, who);
        if (result.kind !== 'ok') return failed(dismissFailure(result));
        // A 200 that still lists the user changed nothing; hiding the item would then hide a
        // live request until restart.
        if (stillRequested(result.body, who)) return failed({ kind: 'error' });
        store.dismiss(key);
        return { kind: 'dismissed' };
      } catch (error) {
        logger.error(
          `dismissing ${key} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return failed({ kind: 'error' });
      }
    },
  };
}
