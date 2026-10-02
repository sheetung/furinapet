import { normalizeStep } from '../actions/steps';
import type { ActionStep } from '../actions/types';

/** Resolve character capability before calculating clip duration. */
export function resolveCharacterStep(step: ActionStep, character: { id: string; source?: string }): ActionStep {
  if (character.id === 'furina' && character.source === 'built-in') return normalizeStep(step);
  const { motion: _motion, ...fallback } = step;
  return normalizeStep(fallback);
}
