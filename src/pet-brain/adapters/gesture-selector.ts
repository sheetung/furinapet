import type { ActionStep } from '../../actions/types';
import type { GestureMotion } from '../../core/sprite-motion';
import type { BrainAgentState, PetSemanticAction } from '../types';
import { reactionForSemanticAction } from './reaction';
import type { NeedsSnapshot } from '../needs';

interface Candidate { motion: GestureMotion; score: number; cooldown: number }
/** Second-stage selection: goals keep their existing utility scores and priority. */
export class GestureSelector {
  private last = new Map<GestureMotion, number>();
  private previous: GestureMotion | undefined;
  select(action: PetSemanticAction, agent: BrainAgentState, energy: number, now: number, needs?: NeedsSnapshot): ActionStep | null {
    const base = reactionForSemanticAction(action, agent);
    if (!base) return null;
    let candidates: Candidate[] = [];
    // Direct clicks retain their familiar response; error/working feedback is never decorated.
    if (action.type === 'idle') candidates = [{ motion: 'double-blink', score: .6, cooldown: 12000 },
      { motion: 'curious', score: .4, cooldown: 20000 }];
    if (action.type === 'rest' && action.durationMs >= 3000 && agent === 'idle') {
      const reason = needs?.reason ?? (energy <= .22 ? 'exhausted' : energy <= .35 ? 'tired' : null);
      const motion = reason === 'exhausted' ? 'doze' : reason === 'tired' ? 'sitting'
        : reason === 'thirsty' ? 'tea' : reason === 'hungry' ? 'cake' : undefined;
      // Need satisfaction, not a cooldown-driven rotation of unrelated props.
      return motion ? { ...base, motion } : base;
    }
    if (action.type === 'celebrate') candidates = [
      { motion: 'proud', score: .8, cooldown: 30000 },
      { motion: 'greeting', score: .6, cooldown: 30000 },
    ];
    const chosen = candidates
      .filter(item => now - (this.last.get(item.motion) ?? -Infinity) >= item.cooldown)
      .map(item => ({ ...item, score: item.score - (item.motion === this.previous ? .4 : 0) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!chosen) return base;
    this.last.set(chosen.motion, now);
    this.previous = chosen.motion;
    return { ...base, motion: chosen.motion };
  }
}
