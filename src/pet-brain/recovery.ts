import type { PlaybackSession, ActionStep } from '../actions/types';
import { DRINK_RATE, FOOD_RATE, ENERGY_RATES, RECOVERY_TARGETS, type NeedReason, type NeedsSnapshot } from './needs';
import { motionDuration } from '../core/sprite-motion';

export type RecoveryReason = Exclude<NeedReason, null>;
export function recoverySatisfied(reason: RecoveryReason, needs: NeedsSnapshot) {
  return reason === 'thirsty' ? needs.thirst <= RECOVERY_TARGETS.thirst
    : reason === 'hungry' ? needs.hunger <= RECOVERY_TARGETS.hunger
    : needs.energy >= RECOVERY_TARGETS.energy;
}

function recoveryStep(reason: RecoveryReason, needs: NeedsSnapshot): ActionStep {
  const activity = reason === 'exhausted' ? 'sleep' : reason === 'thirsty' ? 'tea'
    : reason === 'hungry' ? 'cake' : 'rest';
  const seconds = reason === 'thirsty' ? (needs.thirst - RECOVERY_TARGETS.thirst) / DRINK_RATE
    : reason === 'hungry' ? (needs.hunger - RECOVERY_TARGETS.hunger) / FOOD_RATE
    : (RECOVERY_TARGETS.energy - needs.energy) / ENERGY_RATES[activity];
  return { reaction: activity === 'sleep' ? 'idle' : 'waiting', activity,
    ...(activity === 'sleep' ? { motion: 'doze' as const }
      : activity === 'tea' || activity === 'cake' ? { motion: activity } : {}),
    durationMs: Math.max(250, Math.ceil(seconds * 1000)) };
}

/** Keep one cancellable coordinator session until actual elapsed activity meets the target. */
export async function performNeedRecovery(session: PlaybackSession, reason: RecoveryReason,
  getNeeds: () => NeedsSnapshot) {
  if (session.signal.aborted || recoverySatisfied(reason, getNeeds())) return;
  if (reason === 'thirsty') {
    await session.perform({ reaction: 'waiting', motion: 'tea-enter', durationMs: 0, activity: 'idle' });
    while (!session.signal.aborted && !recoverySatisfied(reason, getNeeds())) {
      const step = recoveryStep(reason, getNeeds());
      const cycle = motionDuration('tea-sip');
      await session.perform({ ...step, motion: 'tea-sip', durationMs: Math.ceil(step.durationMs / cycle) * cycle });
    }
    if (!session.signal.aborted) await session.perform({ reaction: 'waiting', motion: 'tea-exit', durationMs: 0, activity: 'idle' });
    return;
  }
  while (!session.signal.aborted && !recoverySatisfied(reason, getNeeds())) {
    await session.perform(recoveryStep(reason, getNeeds()));
  }
}
