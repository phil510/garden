import type { ReviewItem, ReviewQueue } from '@garden/shared';
import { startReviewSession, updateUiState } from '../../api/client';
import { commandFailureMessage, reportCommandFailure } from '../../api/reportCommandFailure';
import { useReviewStore } from '../../state/reviewStore';
import { useToastStore } from '../../state/toastStore';
import { useUiStore } from '../../state/uiStore';
import { openExternalLink } from '../../terminals/hyperlinks';
import { placeOnStage } from '../sidebar/placeOnStage';
import { formatRelativeTime } from '../sidebar/relativeTime';
import { reviewFaultNotice } from './reviewFaultNotice';
import './reviews.css';

interface ReviewRowProps {
  item: ReviewItem;
  now: number;
  onStart: (item: ReviewItem) => void;
  onOpen: (sessionId: string) => void;
}

/** One request. `.rv-actions` is the trailing slot for per-row buttons. */
export function ReviewRow({ item, now, onStart, onOpen }: ReviewRowProps) {
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
        <div className="rv-actions">
          {item.sessionId !== null ? (
            <button className="small" onClick={() => onOpen(item.sessionId ?? '')}>
              Open session
            </button>
          ) : (
            <>
              {item.clonePath === null && <span className="rv-noclone">no local clone</span>}
              <button
                className="small"
                disabled={item.clonePath === null}
                onClick={() => onStart(item)}
              >
                Start session
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ReviewsPanelViewProps {
  queue: ReviewQueue | null;
  now: number;
  onStart: (item: ReviewItem) => void;
  onOpen: (sessionId: string) => void;
}

export function ReviewsPanelView({ queue, now, onStart, onOpen }: ReviewsPanelViewProps) {
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
            <ReviewRow key={item.key} item={item} now={now} onStart={onStart} onOpen={onOpen} />
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
  const uiState = useUiStore((state) => state.uiState);

  function open(sessionId: string) {
    updateUiState(placeOnStage(uiState.slots, uiState.focusedSlot, sessionId)).catch(
      reportCommandFailure,
    );
  }

  function start(item: ReviewItem) {
    const [owner, name] = item.repo.split('/') as [string, string];
    startReviewSession(owner, name, item.number)
      .then((result) => {
        open(result.sessionId);
      })
      .catch((error: unknown) => {
        reportCommandFailure(error);
        useToastStore.getState().showToast(commandFailureMessage(error));
      });
  }

  return <ReviewsPanelView queue={queue} now={Date.now()} onStart={start} onOpen={open} />;
}

/** The top-bar pill; nothing at zero. */
export function ReviewsCountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="rv-badge">{count}</span>;
}
