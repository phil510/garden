import type { ReviewItem, ReviewQueue } from '@garden/shared';
import { useReviewStore } from '../../state/reviewStore';
import { openExternalLink } from '../../terminals/hyperlinks';
import { formatRelativeTime } from '../sidebar/relativeTime';
import { reviewFaultNotice } from './reviewFaultNotice';
import './reviews.css';

interface ReviewRowProps {
  item: ReviewItem;
  now: number;
}

/** One request. `.rv-actions` is the trailing slot for per-row buttons. */
export function ReviewRow({ item, now }: ReviewRowProps) {
  return (
    <div className="rv-item">
      <div className="rv-top">
        <button
          className="rv-ref"
          title={`Open ${item.repo} #${String(item.number)} on GitHub`}
          onClick={() => openExternalLink(item.url)}
        >
          {item.repo}#{item.number}
        </button>
        {item.draft && <span className="rv-draft">Draft</span>}
      </div>
      <div className="rv-title">{item.title}</div>
      <div className="rv-foot">
        <span className="when">
          {item.author} · {formatRelativeTime(Date.parse(item.updatedAt), now)}
        </span>
        <div className="rv-actions" />
      </div>
    </div>
  );
}

interface ReviewsPanelViewProps {
  queue: ReviewQueue | null;
  now: number;
}

export function ReviewsPanelView({ queue, now }: ReviewsPanelViewProps) {
  const notice = reviewFaultNotice(queue?.fault ?? null);
  const items = queue?.items ?? [];
  const checking = notice === null && (queue === null || queue.polledAt === null);
  // A queue that was never polled has no count worth reporting; "0 requests" would be a claim.
  const summary =
    queue === null || (queue.polledAt === null && items.length === 0)
      ? null
      : `${String(items.length)} ${items.length === 1 ? 'request' : 'requests'}${
          queue.polledAt === null
            ? ''
            : ` · last checked ${formatRelativeTime(Date.parse(queue.polledAt), now)}`
        }`;

  return (
    <div className="awp">
      <div className="awp-head">
        <h2>Reviews</h2>
        {summary !== null && (
          <div className="aw-sum">
            <span>{summary}</span>
          </div>
        )}
      </div>
      {notice !== null && (
        <div className="rv-fault" role="alert">
          {notice}
        </div>
      )}
      {checking ? (
        <div className="aw-empty">
          <div>Checking GitHub for review requests…</div>
        </div>
      ) : items.length > 0 ? (
        <div className="aw-list">
          {items.map((item) => (
            <ReviewRow key={item.key} item={item} now={now} />
          ))}
        </div>
      ) : (
        notice === null && (
          <div className="aw-empty">
            <div>No review requests</div>
            <div className="faint">PRs that request your review show up here.</div>
          </div>
        )
      )}
    </div>
  );
}

/** Review requests in the file panel's slot. */
export function ReviewsPanel() {
  const queue = useReviewStore((state) => state.queue);
  return <ReviewsPanelView queue={queue} now={Date.now()} />;
}

/** The top-bar pill; nothing at zero. */
export function ReviewsCountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="rv-badge">{count}</span>;
}
