export type MotionOwner = 'wander' | 'gravity' | 'layout' | 'drag' | 'reset';
const priority: Record<MotionOwner, number> = { wander: 10, gravity: 20, layout: 30, drag: 40, reset: 50 };
export interface MotionLease { valid(): boolean; release(): void }

/** One owner for programmatic geometry. Old releases never clear a replacement. */
export class MotionAuthority {
  private current: { kind: MotionOwner; token: symbol } | null = null;
  get owner() { return this.current?.kind ?? null; }
  acquire(kind: MotionOwner): MotionLease | null {
    if (this.current && priority[this.current.kind] > priority[kind]) return null;
    const owner = { kind, token: Symbol(kind) };
    this.current = owner;
    return { valid: () => this.current === owner,
      release: () => { if (this.current === owner) this.current = null; } };
  }
  cancel(...kinds: MotionOwner[]) {
    if (this.current && (!kinds.length || kinds.includes(this.current.kind))) this.current = null;
  }
}
