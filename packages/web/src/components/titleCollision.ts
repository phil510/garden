export interface HorizontalSpan {
  left: number;
  right: number;
}

/** True when a title of `titleWidth`, centred on `barCentre`, would come within `gap` of any
 *  of the `neighbours`. */
export function titleCollides(
  barCentre: number,
  titleWidth: number,
  neighbours: readonly HorizontalSpan[],
  gap: number,
): boolean {
  const left = barCentre - titleWidth / 2 - gap;
  const right = barCentre + titleWidth / 2 + gap;
  return neighbours.some((n) => n.right > left && n.left < right);
}
