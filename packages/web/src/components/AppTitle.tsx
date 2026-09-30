import { useLayoutEffect, useRef, useState } from 'react';
import './app-title.css';
import { titleCollides } from './titleCollision';

const GAP_PX = 16;

/** The console's name in the centre of the top bar. Purely decorative: it is positioned
 *  against the full-width `.topbar`, so it stays centred on the window regardless of what
 *  sits on either side, and it hides itself whenever that centred spot would come within
 *  `GAP_PX` of a sibling, however wide the siblings get. */
export function AppTitle() {
  const ref = useRef<HTMLDivElement>(null);
  const [collides, setCollides] = useState(false);

  useLayoutEffect(() => {
    const title = ref.current;
    const bar = title?.parentElement;
    if (!title || !bar) return;
    const neighbours = Array.from(bar.children).filter(
      (el) => el !== title && !el.classList.contains('topbar-spacer'),
    );

    const measure = () => {
      const barRect = bar.getBoundingClientRect();
      setCollides(
        titleCollides(
          barRect.left + barRect.width / 2,
          title.getBoundingClientRect().width,
          neighbours.map((el) => el.getBoundingClientRect()),
          GAP_PX,
        ),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    for (const el of [bar, ...neighbours]) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="app-title" style={collides ? { visibility: 'hidden' } : undefined}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 22V11" />
        <path d="M12 11C12 7 9 4 4 4c0 4 3 7 8 7Z" />
        <path d="M12 14c0-3 2-5 7-5 0 3-2 5-7 5Z" />
      </svg>
      <span>garden</span>
    </div>
  );
}
