export interface Point { x: number; y: number }
export interface LookCell { index: number; row: 9 | 10; column: number }

/** Maps a screen-space point to the v2 atlas clockwise sequence, where 000 is up. */
export function computeLookDirection(origin: Point, target: Point): LookCell {
  const clockwiseFromUp = Math.atan2(target.x - origin.x, origin.y - target.y) * 180 / Math.PI;
  const normalized = (clockwiseFromUp + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return index < 8
    ? { index, row: 9, column: index }
    : { index, row: 10, column: index - 8 };
}
