import type { FeatureDescriptor } from "../types";

/** Compile-time extension seam: no runtime plugin host or marketplace is shipped. */
export const featureRegistry: readonly FeatureDescriptor[] = [
  { id: "cursor-gaze", name: "视线跟随", description: "使用 v2 图集的 16 个方向看向全局鼠标。" },
  { id: "auto-wander", name: "自动漫步", description: "在当前屏幕内轻量移动并切换左右行走动画。" },
] as const;
