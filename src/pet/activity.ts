import type { Activity } from '../pet-brain/needs';

export function currentPetActivity(input: {
  visible: boolean; dragging: boolean; falling: boolean;
  execution: Activity | null; locomotion: Activity;
}): Activity {
  if (!input.visible || input.dragging || input.falling) return 'paused';
  return input.execution ?? input.locomotion;
}
