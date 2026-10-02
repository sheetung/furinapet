export function bubbleLayout(input: {
  x: number; y: number; width: number; height: number;
  scale: number; factor: number; expanded: boolean; workAreaTop: number;
}) {
  const width = Math.round(192 * input.scale * input.factor);
  const baseHeight = Math.round(208 * input.scale * input.factor);
  const feet = input.y + input.height;
  const head = feet - baseHeight;
  const extra = Math.round(92 * input.factor);
  const above = input.expanded && head - extra >= input.workAreaTop;
  const height = baseHeight + (above ? extra : 0);
  return { x: Math.round(input.x + (input.width - width) / 2), y: feet - height,
    width, height, placement: above ? 'above' as const : 'inside' as const };
}
