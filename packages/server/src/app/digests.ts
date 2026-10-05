import type { DigestDetail } from '@garden/shared';
import { DigestNotFoundError } from './errors.js';
import type { Projection } from './projection.js';

export { DigestNotFoundError } from './errors.js';

export interface DigestsDeps {
  readonly projection: Pick<Projection, 'overlay'>;
}

/** The detail an archived digest counted, whichever session it was delivered to. */
export function getDigest(deps: DigestsDeps, id: string): DigestDetail {
  const record = deps.projection.overlay().digests.find((r) => r.detail.id === id);
  if (record === undefined) throw new DigestNotFoundError(`no digest ${id}`);
  return record.detail;
}
