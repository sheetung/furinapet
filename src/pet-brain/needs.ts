export type Activity = 'idle' | 'walk' | 'play' | 'rest' | 'sleep' | 'tea' | 'cake' | 'paused';
export type NeedReason = 'exhausted' | 'tired' | 'thirsty' | 'hungry' | null;
export interface NeedsSnapshot { energy: number; thirst: number; hunger: number; recovering: boolean; activity: Activity; reason: NeedReason }
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Effects are earned by elapsed activity, never by merely selecting a plan. */
export class PetNeeds {
  private energy = .78;
  private thirst = .1;
  private hunger = .1;
  private recovering = false;
  private activity: Activity = 'paused';
  private previous: number | null = null;
  observe(activity: Activity, now: number) {
    const seconds = this.previous === null ? 0 : Math.min(2, Math.max(0, now - this.previous) / 1000);
    this.previous = now;
    const previous = this.activity;
    this.activity = activity;
    if (previous !== 'paused' && activity !== 'paused') {
      const energyRate: Record<Activity, number> = {
        idle: .0008, walk: -.0045, play: -.008, rest: .012, sleep: .024, tea: .003, cake: .003, paused: 0,
      };
      this.energy = clamp(this.energy + energyRate[previous] * seconds);
      this.thirst = clamp(this.thirst + (previous === 'tea' ? -.16 : previous === 'walk' || previous === 'play' ? .003 : .0007) * seconds);
      this.hunger = clamp(this.hunger + (previous === 'cake' ? -.15 : previous === 'walk' || previous === 'play' ? .0015 : .00035) * seconds);
    }
    if (this.energy <= .35) this.recovering = true;
    else if (this.energy >= .7) this.recovering = false;
  }
  snapshot(): NeedsSnapshot {
    const reason: NeedReason = this.energy <= .22 ? 'exhausted'
      : this.recovering ? 'tired' : this.thirst >= .65 ? 'thirsty' : this.hunger >= .65 ? 'hungry' : null;
    return { energy: this.energy, thirst: this.thirst, hunger: this.hunger, recovering: this.recovering, activity: this.activity, reason };
  }
}

export function activityForMotion(motion: string, visible: boolean): Activity {
  if (!visible || motion === 'dragged' || motion === 'falling') return 'paused';
  if (['run-left', 'run-right', 'airborne', 'running'].includes(motion)) return 'walk';
  if (['jumping', 'greeting', 'proud', 'waving'].includes(motion)) return 'play';
  if (motion === 'doze') return 'sleep';
  if (['sitting', 'dock-sitting', 'waiting', 'stretch-yawn'].includes(motion)) return 'rest';
  if (motion === 'tea' || motion === 'cake') return motion;
  return 'idle';
}
