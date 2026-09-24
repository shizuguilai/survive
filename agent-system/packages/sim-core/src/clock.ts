/** Authoritative 50ms clock. Wall-time is a renderer scheduling input only. */
export const FIXED_DT_MS = 50;
export class SimulationClock {
  readonly fixedDtMs = FIXED_DT_MS;
  readonly pauseTokens = new Set<string>();
  private lastWallMs: number | null = null;
  private accumulatorMs = 0;
  speed = 1;
  get paused(): boolean { return this.pauseTokens.size > 0; }
  acquire(token: string): void { this.pauseTokens.add(token); this.resetFrameBaseline(); }
  release(token: string): void { this.pauseTokens.delete(token); this.resetFrameBaseline(); }
  resetFrameBaseline(): void { this.lastWallMs = null; this.accumulatorMs = 0; }
  frame(nowWallMs: number, step: () => boolean): number {
    if (!Number.isFinite(nowWallMs)) throw new Error('Invalid observer frame timestamp');
    if (this.paused || this.lastWallMs === null) { this.lastWallMs = nowWallMs; this.accumulatorMs = 0; return 0; }
    const delta = Math.max(0, Math.min(250, nowWallMs - this.lastWallMs));
    this.lastWallMs = nowWallMs;
    this.accumulatorMs += delta * Math.max(0, Math.min(8, this.speed));
    let count = 0;
    while (this.accumulatorMs >= this.fixedDtMs && !this.paused) {
      this.accumulatorMs -= this.fixedDtMs;
      if (!step()) break;
      count++;
    }
    if (this.paused) this.accumulatorMs = 0;
    return count;
  }
}
