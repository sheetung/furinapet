export interface MotionArtFrame {
  asset: 'idle' | 'waving' | 'jumping' | 'review';
  atlasWidth: number;
  atlasHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  scale: number;
}

/** Source crops preserve pixels; rendering aligns feet at (96, 200). */
export function replacementFrame(characterId: string, source: string | undefined, row: number, column: number): MotionArtFrame | null {
  if (characterId !== 'furina' || source !== 'built-in') return null;
  if (!Number.isInteger(column)) return null;
  if (row === 0 && column >= 0 && column < 6) {
    return { asset: 'idle', atlasWidth: 1536, atlasHeight: 1024,
      x: [160, 608, 1090, 160, 612, 1090][column], y: column < 3 ? 0 : 512, width: 288, height: 512,
      anchorX: 144, anchorY: 504, scale: 190 / 498 };
  }
  if (row === 3 && column >= 0 && column < 4) {
    return { asset: 'waving', atlasWidth: 2161, atlasHeight: 728,
      x: [74, 614, 1152, 1688][column], y: 8, width: 396, height: 712,
      anchorX: 198, anchorY: 708, scale: 190 / 700 };
  }
  if (row === 4 && column >= 0 && column < 5) {
    // Keep a shared baseline and scale: do not normalize away the airborne height.
    return { asset: 'jumping', atlasWidth: 1536, atlasHeight: 1024,
      x: [132, 604, 1106, 138, 602][column], y: column < 3 ? 0 : 512, width: 330, height: 512,
      anchorX: 165, anchorY: 504, scale: 190 / 498 };
  }
  if (row === 8 && column >= 0 && column < 6) {
    return { asset: 'review', atlasWidth: 1536, atlasHeight: 1024,
      x: [160, 608, 1088, 160, 614, 1088][column], y: column < 3 ? 0 : 512, width: 288, height: 512,
      anchorX: 144, anchorY: 506, scale: 190 / 498 };
  }
  return null;
}

export function replacementStyle(frame: MotionArtFrame, url: string) {
  return {
    left: 96 - frame.anchorX * frame.scale,
    top: 200 - frame.anchorY * frame.scale,
    width: frame.width * frame.scale,
    height: frame.height * frame.scale,
    backgroundImage: `url("${url}")`,
    backgroundSize: `${frame.atlasWidth * frame.scale}px ${frame.atlasHeight * frame.scale}px`,
    backgroundPosition: `${-frame.x * frame.scale}px ${-frame.y * frame.scale}px`,
  };
}
