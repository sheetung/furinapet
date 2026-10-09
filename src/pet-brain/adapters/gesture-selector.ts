import type { ActionStep } from '../../actions/types';
import type { GestureMotion } from '../../core/sprite-motion';
import type { BrainAgentState, PetSemanticAction } from '../types';
import { reactionForSemanticAction } from './reaction';
import type { NeedsSnapshot } from '../needs';

interface Candidate { motion: GestureMotion; score: number; cooldown: number }
/** Second-stage selection: goals keep their existing utility scores and priority. */
export class GestureSelector {
  private last = new Map<GestureMotion, number>();
  private history: { motion: GestureMotion; at: number }[] = [];
  recordPerformed(step: ActionStep, now: number) {
    if (!step.motion) return;
    this.last.set(step.motion, now);
    this.history = [...this.history.filter(item => now - item.at < 180000),
      { motion: step.motion, at: now }].slice(-16);
  }
  select(action: PetSemanticAction, agent: BrainAgentState, energy: number, now: number, needs?: NeedsSnapshot): ActionStep | null {
    const base = reactionForSemanticAction(action, agent);
    if (!base) return null;
    let candidates: Candidate[] = [];
    // A calm click can nod; error/working feedback is never decorated.
    if (action.type === 'respond' && action.intensity === 'soft') candidates = [{ motion: 'nod', score: .7, cooldown: 30000 }];
    if (action.type === 'idle') candidates = [{ motion: 'double-blink', score: .6, cooldown: 60000 }];
    if (action.type === 'rest' && action.durationMs >= 3000 && agent === 'idle') {
      const reason = needs?.reason ?? (energy <= .22 ? 'exhausted' : energy <= .35 ? 'tired' : null);
      const motion = reason === 'exhausted' ? 'doze' : reason === 'tired' ? 'sitting'
        : reason === 'thirsty' ? 'tea' : reason === 'hungry' ? 'cake' : undefined;
      // Need satisfaction, not a cooldown-driven rotation of unrelated props.
      return motion ? { ...base, motion, activity: motion === 'doze' ? 'sleep'
        : motion === 'tea' || motion === 'cake' ? motion : 'rest' } : base;
    }
    if (action.type === 'celebrate') candidates = [
      { motion: 'proud', score: .8, cooldown: 30000 },
      { motion: 'greeting', score: .6, cooldown: 30000 },
    ];
    const chosen = candidates
      .filter(item => now - (this.last.get(item.motion) ?? -Infinity) >= item.cooldown)
      .map(item => {
        const repeats = this.history.filter(previous => previous.motion === item.motion)
          .reduce((count, previous) => count + Math.max(0, 1 - Math.max(0, now - previous.at) / 180000), 0);
        return { ...item, score: item.score / (1 + repeats) };
      })
      .sort((a, b) => b.score - a.score)[0];
    if (!chosen) return base;
    return { ...base, motion: chosen.motion, ...(chosen.motion === 'nod' ? { activity: 'observe' as const } : {}) };
  }
}
