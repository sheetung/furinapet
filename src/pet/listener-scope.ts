/** Handles listeners whose native registration resolves after component cleanup. */
export class ListenerScope {
  private active = true;
  private cleanups: (() => void)[] = [];
  get alive() { return this.active; }
  guard<T>(callback: (value: T) => void) {
    return (value: T) => { if (this.active) callback(value); };
  }
  add(registration: Promise<() => void>, report: (error: unknown) => void) {
    void registration.then(cleanup => {
      if (this.active) this.cleanups.push(cleanup);
      else cleanup();
    }).catch(error => { if (this.active) report(error); });
  }
  dispose() {
    this.active = false;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}
