import { furinaClips } from '../characters/furina-clips';
import { clipDuration, clipPhase, sampleClip } from '../animation/clip';
import type { Reaction } from '../types';

export type GestureMotion = 'double-blink' | 'curious' | 'doze' | 'greeting' | 'sitting' | 'stretch-yawn' | 'tea' | 'cake' | 'proud';
export type MotionReaction = Reaction | GestureMotion | 'run-left' | 'run-right' | 'airborne' | 'falling' | 'dragged';

export function locomotionReaction(dx: number, dy: number, grounded: boolean): MotionReaction {
  if (!grounded && Math.abs(dy) > Math.abs(dx) * 1.25) return dy < 0 ? 'airborne' : 'falling';
  return dx >= 0 ? 'run-right' : 'run-left';
}

export function isTravelMotion(reaction: MotionReaction) {
  return ['run-left', 'run-right', 'airborne', 'falling'].includes(reaction);
}
export type { AnimationClip as FrameRow } from '../animation/clip';
export { furinaClips as frameRows } from '../characters/furina-clips';

export function motionDuration(reaction: MotionReaction) {
  return clipDuration(furinaClips[reaction]);
}
export function motionPhase(reaction: MotionReaction, elapsedMs: number) {
  return clipPhase(furinaClips[reaction], elapsedMs);
}
export function resolveMotion(step: { reaction: Reaction; motion?: GestureMotion }, characterId: string, source?: string): MotionReaction {
  return characterId === 'furina' && source === 'built-in' && step.motion ? step.motion : step.reaction;
}
export function sampleMotion(reaction: MotionReaction, elapsedMs: number) {
  return sampleClip(furinaClips[reaction], elapsedMs);
}
