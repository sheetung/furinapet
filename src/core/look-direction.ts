export interface Point { x: number; y: number }
export interface LookCell { index: number; row: 9 | 10; column: number }

function lookCell(index: number): LookCell {
  const normalized = ((index % 16) + 16) % 16;
  return normalized < 8
    ? { index: normalized, row: 9, column: normalized }
    : { index: normalized, row: 10, column: normalized - 8 };
}

/** Maps a screen-space point to the v2 atlas clockwise sequence, where 000 is up. */
export function computeLookDirection(origin: Point, target: Point): LookCell {
  const clockwiseFromUp = Math.atan2(target.x - origin.x, origin.y - target.y) * 180 / Math.PI;
  const normalized = (clockwiseFromUp + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return lookCell(index);
}

/** Reflects the atlas lookup across the vertical axis for counterclockwise look rows. */
export function mapLookDirection(cell: LookCell, order: "clockwise" | "counterclockwise" = "clockwise"): LookCell {
  return order === "counterclockwise" ? lookCell(16 - cell.index) : cell;
}
