/** Distance affects acquisition, not direction updates during an engaged glance. */
export class GazeInterest {
  private nextAttempt = -Infinity;
  private engagedUntil = -Infinity;
  constructor(private random: () => number = Math.random) {}
  reset() { this.nextAttempt = this.engagedUntil = -Infinity; }
  allows(distance: number, moving: boolean, now: number) {
    if (distance <= 650) return true;
    if (now < this.engagedUntil) return true;
    if (!moving || now < this.nextAttempt) return false;
    this.nextAttempt = now + 600;
    const probability = Math.min(1, 650 / distance);
    if (this.random() >= probability) return false;
    this.engagedUntil = now + 2400;
    return true;
  }
}
