import type { AddWatchRequest, WatchKind } from '@garden/shared';

export const FORM_KINDS = ['review', 'comment', 'checks', 'conflict'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export interface WatchForm {
  pr: string;
  repo: string;
  kinds: Record<FormKind, boolean>;
  checksAll: boolean;
}

export function initialWatchForm(): WatchForm {
  return {
    pr: '',
    repo: '',
    kinds: { review: true, comment: true, checks: true, conflict: true },
    checksAll: false,
  };
}

export type WatchFormResult = { ok: true; body: AddWatchRequest } | { ok: false; message: string };

const REPO_PATTERN = /^[^\s/]+\/[^\s/]+$/;

/** A blank repo is omitted so the server defaults it to the session's remote. `closed` is
 *  always watched. */
export function toAddWatchRequest(form: WatchForm): WatchFormResult {
  const prText = form.pr.trim().replace(/^#/, '');
  const pr = /^\d+$/.test(prText) ? Number(prText) : 0;
  if (pr < 1) return { ok: false, message: 'Enter a PR number, like 241.' };

  const repo = form.repo.trim();
  if (repo !== '' && !REPO_PATTERN.test(repo)) {
    return { ok: false, message: 'Repo must look like owner/name.' };
  }

  const kinds: WatchKind[] = FORM_KINDS.filter((kind) => form.kinds[kind]).map((kind) =>
    kind === 'checks' && form.checksAll ? 'checks:all' : kind,
  );
  kinds.push('closed');

  return { ok: true, body: { pr, ...(repo === '' ? {} : { repo }), kinds } };
}
