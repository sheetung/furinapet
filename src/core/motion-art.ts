export interface MotionArtFrame {
  asset: string;
  atlasWidth: number;
  atlasHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  scale: number;
  targetY?: number;
}

export function replacementStyle(frame: MotionArtFrame, url: string) {
  return {
    left: 96 - frame.anchorX * frame.scale,
    top: (frame.targetY ?? 200) - frame.anchorY * frame.scale,
    width: frame.width * frame.scale,
    height: frame.height * frame.scale,
    backgroundImage: `url("${url}")`,
    backgroundSize: `${frame.atlasWidth * frame.scale}px ${frame.atlasHeight * frame.scale}px`,
    backgroundPosition: `${-frame.x * frame.scale}px ${-frame.y * frame.scale}px`,
  };
}
