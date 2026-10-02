export interface BubbleRequest { id: string; text: string; durationMs?: number; priority?: number }
export interface BubbleContent { id: string; text: string; expiresAt: number | null; priority: number }
export const BUBBLE_EVENT = 'pet-bubble';

/** Independent notification lifetime; hiding does not pause expiry. No action imports. */
export class BubbleController {
  private content: BubbleContent | null = null;
  private visible = true;
  private cancel = () => {};
  private listeners = new Set<() => void>();
  constructor(private now = () => Date.now(), private schedule = (fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms); return () => clearTimeout(timer);
  }) {}
  snapshot() {
    return this.visible && this.content && (this.content.expiresAt === null || this.content.expiresAt > this.now())
      ? { ...this.content } : null;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish() { for (const listener of this.listeners) listener(); }
  show(request: BubbleRequest) {
    if (!request || typeof request.id !== 'string' || !request.id || typeof request.text !== 'string'
      || !request.text.trim() || request.text.length > 4000) return false;
    const duration = request.durationMs ?? 6000, priority = request.priority ?? 10;
    if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(priority)) return false;
    const current = this.content;
    if (current && (current.expiresAt === null || current.expiresAt > this.now())
      && current.id !== request.id && current.priority > priority) return false;
    this.cancel();
    const content = { id: request.id, text: request.text, priority, expiresAt: duration === 0 ? null : this.now() + duration };
    this.content = content;
    this.cancel = duration === 0 ? () => {} : this.schedule(() => {
      if (this.content !== content) return;
      this.content = null; this.publish();
    }, duration);
    this.publish(); return true;
  }
  dismiss(id?: string) {
    if (id !== undefined && this.content?.id !== id) return;
    this.cancel(); this.content = null; this.publish();
  }
  setVisible(visible: boolean) { this.visible = visible; this.publish(); }
}
export const bubbles = new BubbleController();
