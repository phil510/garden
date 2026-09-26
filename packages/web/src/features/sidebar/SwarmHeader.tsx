import type { DraggableAttributes } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import type { KeyboardEvent } from 'react';
import type { SwarmGroup } from './groupSwarms';

interface SwarmHeaderProps {
  swarm: Pick<SwarmGroup, 'swarmId' | 'name' | 'repoCount' | 'attention' | 'collapsed'>;
  onToggle: () => void;
  className?: string;
  /** `useSortable`'s drag attributes/listeners for an active swarm, spread onto the header
   *  div; omitted for a Finished-section entry, which isn't reorderable. */
  dragAttributes?: DraggableAttributes;
  dragListeners?: ReturnType<typeof useSortable>['listeners'];
}

/** The swarm-header row shared by an active swarm and a Finished-section entry: chevron,
 *  name, repo count, attention badge. Finished entries pass no drag props and fold in their
 *  own `finished` class via `className`. */
export function SwarmHeader({
  swarm,
  onToggle,
  className = '',
  dragAttributes,
  dragListeners,
}: SwarmHeaderProps) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onToggle();
  }

  return (
    <div
      className={`swarm-header${swarm.collapsed ? ' collapsed' : ''}${className ? ` ${className}` : ''}`}
      data-swarm-id={swarm.swarmId}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      {...dragAttributes}
      {...dragListeners}
    >
      <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
        <path d="M6 9l6 6 6-6" />
      </svg>
      <span className="swarm-name">{swarm.name}</span>
      <span className="swarm-repos mono">
        {swarm.repoCount} repo{swarm.repoCount === 1 ? '' : 's'}
      </span>
      {swarm.attention > 0 && <span className="swarm-attn-badge">{swarm.attention}</span>}
    </div>
  );
}
