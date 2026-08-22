export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface LookDirectionCell {
  readonly index: number;
  readonly column: number;
  readonly row: 9 | 10;
}

const lookDirectionCount = 16;
const degreesPerDirection = 360 / lookDirectionCount;

/** Maps a screen-space target to the v2 atlas' clockwise order, where 000 is up. */
export function computeLookDirectionIndex(origin: ScreenPoint, target: ScreenPoint): number {
  const clockwiseFromUp = Math.atan2(target.x - origin.x, origin.y - target.y) * 180 / Math.PI;
  const normalized = (clockwiseFromUp + 360) % 360;
  return Math.round(normalized / degreesPerDirection) % lookDirectionCount;
}

export function getLookDirectionCell(index: number): LookDirectionCell {
  const normalized = ((Math.round(index) % lookDirectionCount) + lookDirectionCount) % lookDirectionCount;
  return normalized < 8
    ? { index: normalized, column: normalized, row: 9 }
    : { index: normalized, column: normalized - 8, row: 10 };
}
