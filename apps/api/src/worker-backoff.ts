/**
 * Tick gate for the 5-second worker loops: the first failure is retried on the next tick, then
 * every 2, 4, 8… ticks (capped), so a lost database or provider is retried at a bounded rate
 * instead of every tick; one successful batch restores the normal cadence.
 */
export class WorkerBackoff {
  private streak = 0;
  private skip = 0;
  constructor(private readonly maxSkippedTicks = 12) {}
  /** True when this tick may run; false while the loop is still backing off. */
  due(): boolean {
    if (this.skip > 0) {
      this.skip--;
      return false;
    }
    return true;
  }
  failed() {
    this.streak++;
    this.skip = Math.min(this.maxSkippedTicks, 2 ** (this.streak - 1) - 1);
  }
  succeeded() {
    this.streak = 0;
    this.skip = 0;
  }
}
