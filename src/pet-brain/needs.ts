export type Activity = 'idle' | 'walk' | 'play' | 'observe' | 'rest' | 'sleep' | 'tea' | 'cake' | 'paused';
export type NeedReason = 'exhausted' | 'tired' | 'thirsty' | 'hungry' | null;
export interface NeedsSnapshot { energy: number; thirst: number; hunger: number; recovering: boolean; activity: Activity; reason: NeedReason }
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const RECOVERY_TARGETS = { energy: .7, thirst: .25, hunger: .25 } as const;
export const ENERGY_RATES: Record<Activity, number> = {
  idle: .0008, walk: -.0045, play: -.008, observe: -.0008,
  rest: .012, sleep: .024, tea: .003, cake: .003, paused: 0,
};
export const DRINK_RATE = .16;
export const FOOD_RATE = .15;

/** Effects are earned by elapsed activity, never by merely selecting a plan. */
export class PetNeeds {
  private energy = .78;
  private thirst = .1;
  private hunger = .1;
  private recovering = false;
  private thirsty = false;
  private hungry = false;
  private activity: Activity = 'paused';
  private previous: number | null = null;
  observe(activity: Activity, now: number) {
    const seconds = this.previous === null ? 0 : Math.min(2, Math.max(0, now - this.previous) / 1000);
    this.previous = now;
    const previous = this.activity;
    this.activity = activity;
    if (previous !== 'paused') {
      this.energy = clamp(this.energy + ENERGY_RATES[previous] * seconds);
      this.thirst = clamp(this.thirst + (previous === 'tea' ? -DRINK_RATE : previous === 'walk' || previous === 'play' ? .003 : .0007) * seconds);
      this.hunger = clamp(this.hunger + (previous === 'cake' ? -FOOD_RATE : previous === 'walk' || previous === 'play' ? .0015 : .00035) * seconds);
    }
    if (this.energy <= .35) this.recovering = true;
    else if (this.energy >= RECOVERY_TARGETS.energy) this.recovering = false;
    if (this.thirst >= .65) this.thirsty = true;
    else if (this.thirst <= RECOVERY_TARGETS.thirst) this.thirsty = false;
    if (this.hunger >= .65) this.hungry = true;
    else if (this.hunger <= RECOVERY_TARGETS.hunger) this.hungry = false;
  }
  snapshot(): NeedsSnapshot {
    const reason: NeedReason = this.energy <= .22 ? 'exhausted'
      : this.recovering ? 'tired' : this.thirsty ? 'thirsty' : this.hungry ? 'hungry' : null;
    return { energy: this.energy, thirst: this.thirst, hunger: this.hunger, recovering: this.recovering, activity: this.activity, reason };
  }
}
