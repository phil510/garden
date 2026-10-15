import { removeWatch, updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { StatusPill } from '../../components/StatusPill';
import { usePipeGraceStore } from '../../state/pipeGraceStore';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { openExternalLink } from '../../terminals/hyperlinks';
import { lastPathSegment } from '../sidebar/lastPathSegment';
import { placeOnStage } from '../sidebar/placeOnStage';
import { collectWatchGroups, summarizeWatchGroups } from './allWatches';
import { PipeFaultBlock, WatchList } from './WatchList';
import { watchPrUrl } from './watchStatus';
import './watches.css';

/** Every session's watches in one list, faults first, in the file panel's slot. */
export function WatchesPanel() {
  const sessions = useSessionStore((state) => state.sessions);
  const uiState = useUiStore((state) => state.uiState);
  const pipeFaulted = usePipeGraceStore((state) => state.faulted);

  const groups = collectWatchGroups(Object.values(sessions), pipeFaulted);
  const summary = summarizeWatchGroups(groups);

  function focusSession(id: string) {
    updateUiState(placeOnStage(uiState.slots, uiState.focusedSlot, id)).catch(reportCommandFailure);
  }

  return (
    <div className="awp">
      <div className="awp-head">
        <h2>Watches</h2>
        {groups.length > 0 && (
          <div className="aw-sum">
            <span>
              {summary.watches} {summary.watches === 1 ? 'watch' : 'watches'} in {summary.sessions}{' '}
              {summary.sessions === 1 ? 'session' : 'sessions'}
            </span>
            {summary.faultedSessions > 0 && (
              <span className="bad">{summary.faultedSessions} with a fault</span>
            )}
            {summary.pendingDigests > 0 && <span>{summary.pendingDigests} digest pending</span>}
          </div>
        )}
      </div>
      {groups.length === 0 ? (
        <div className="aw-empty">
          <div>No session is watching anything.</div>
          <div className="faint">
            Right-click a session in the sidebar and choose Watch a PR… to start one.
          </div>
        </div>
      ) : (
        <div className="aw-list">
          {groups.map(({ session, pipeFaulted: sessionPipeFaulted }) => {
            const dead = session.liveness === 'dead';
            return (
              <div className="aw-group" key={session.id}>
                <button
                  className={`aw-session${dead ? ' dead' : ''}`}
                  onClick={() => focusSession(session.id)}
                >
                  <span className="t">{session.title ?? lastPathSegment(session.cwd)}</span>
                  {dead ? (
                    <span className="deadtag">dead</span>
                  ) : (
                    session.status !== null && <StatusPill status={session.status} />
                  )}
                  <span className="r">{lastPathSegment(session.repoRoot ?? session.cwd)}</span>
                </button>
                {sessionPipeFaulted && <PipeFaultBlock />}
                <WatchList
                  watches={session.watches}
                  onOpenPr={(watch) => openExternalLink(watchPrUrl(watch))}
                  onStop={(watch) => {
                    removeWatch(session.id, watch.pr, watch.repo).catch(reportCommandFailure);
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
