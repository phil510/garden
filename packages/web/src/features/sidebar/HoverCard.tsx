import type { SessionState } from '@garden/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { computeHoverCardPosition } from './hoverCardPosition';
import { formatRelativeTime } from './relativeTime';

interface HoverCardProps {
  title: string;
  session: SessionState;
  anchor: HTMLElement;
  now: number;
}

export function HoverCard({ title, session, anchor, now }: HoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card === null) return;
    const rect = anchor.getBoundingClientRect();
    setPosition(
      computeHoverCardPosition(rect, card.offsetHeight, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [anchor]);

  return (
    <div
      ref={cardRef}
      className="hover-card"
      style={
        position === null ? { visibility: 'hidden' } : { left: position.left, top: position.top }
      }
    >
      <div className="hc-title">{title}</div>
      <div className="hc-recap">{session.recap ?? 'No recap yet.'}</div>
      <div className="hc-row">
        <span className="hc-k">cwd</span>
        <span className="hc-v">{session.cwd}</span>
      </div>
      <div className="hc-row">
        <span className="hc-k">activity</span>
        <span className="hc-v">{formatRelativeTime(session.lastActivity, now)}</span>
      </div>
    </div>
  );
}
