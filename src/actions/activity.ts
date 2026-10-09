import type { ActionStep } from './types';
import type { Activity } from '../pet-brain/needs';

/** Defaults describe the requested activity, independently of the displayed frame. */
export function activityForStep(step: ActionStep): Activity {
  if (step.activity) return step.activity;
  switch (step.motion) {
    case 'doze': return 'sleep';
    case 'sitting': case 'stretch-yawn': return 'rest';
    case 'tea': case 'tea-sip': return 'tea';
    case 'breathing': case 'tea-enter': case 'tea-exit': return 'idle';
    case 'nod': return 'observe';
    case 'cake': return 'cake';
    case 'greeting': case 'proud': return 'play';
    case 'curious': return 'observe';
    case 'double-blink': return 'idle';
  }
  if (step.reaction === 'waving' || step.reaction === 'jumping') return 'play';
  if (step.reaction === 'review' || step.reaction === 'running') return 'observe';
  return 'idle';
}
