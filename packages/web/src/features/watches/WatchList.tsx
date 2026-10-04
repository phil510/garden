import type { WatchSummary } from '@garden/shared';
import { PrIcon } from './WatchIcons';
import { PIPE_FAULT, kindsLabel, watchLineState } from './watchStatus';
import './watches.css';

interface WatchListProps {
  watches: readonly WatchSummary[];
  /** Shows a stop button on each row when given. */
  onStop?: (watch: WatchSummary) => void;
}

export function PipeFaultBlock() {
  return (
    <div className="fault">
      <b>{PIPE_FAULT.label}</b>
      <span>{PIPE_FAULT.fix}</span>
    </div>
  );
}

export function WatchList({ watches, onStop }: WatchListProps) {
  return (
    <div className="wl">
      {watches.map((watch) => {
        const { tone, label } = watchLineState(watch);
        return (
          <div className="wl-row" key={`${watch.repo}#${String(watch.pr)}`}>
            <div className="wl-head">
              <span className="kind-mark" title="Pull request">
                <PrIcon />
              </span>
              <span className="wl-pr">#{watch.pr}</span>
              <span className="wl-repo">{watch.repo}</span>
              <span className={`wl-state st-${tone}`}>
                <span className="dot" />
                {label}
              </span>
            </div>
            {onStop !== undefined && (
              <button
                className="ghost icon-btn wl-stop"
                title={`Stop watching #${String(watch.pr)}`}
                aria-label={`Stop watching ${watch.repo} #${String(watch.pr)}`}
                onClick={() => onStop(watch)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
            <div className="wl-kinds">{kindsLabel(watch.kinds)}</div>
            {watch.errorReason !== undefined && watch.status === 'error' && (
              <div className="wl-error">{watch.errorReason}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
