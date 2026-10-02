/** Serializes native mutations; validity is rechecked when a queued job starts. */
export class MotionWriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private revisions = { motion: 0, layout: 0 };
  invalidate(scope: 'motion' | 'layout' = 'motion') { this.revisions[scope]++; }
  drain() { return this.tail; }
  enqueue(operation: () => Promise<void>, valid: () => boolean = () => true,
    scope: 'motion' | 'layout' = 'motion'): Promise<boolean> {
    const revision = this.revisions[scope];
    const task = this.tail.then(async () => {
      if (revision !== this.revisions[scope] || !valid()) return false;
      await operation();
      return true;
    });
    // A failed platform call must not poison subsequent work or drain().
    this.tail = task.then(() => {}, () => {});
    return task;
  }
}
