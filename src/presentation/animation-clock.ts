export interface AnimationFrameHost {
  cancelAnimationFrame(frameId: number): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
}

type AnimationFrameCallback = (timestamp: number, deltaMs: number) => void;

export class AnimationClock {
  private frameId: number | null = null;
  private lastTimestamp: number | null = null;
  private running = false;

  constructor(
    private readonly callback: AnimationFrameCallback,
    private readonly host: AnimationFrameHost = globalThis,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.frameId = this.host.requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    this.lastTimestamp = null;
    if (this.frameId !== null) {
      this.host.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private readonly tick = (timestamp: number): void => {
    if (!this.running) {
      return;
    }
    const deltaMs =
      this.lastTimestamp === null
        ? 1000 / 120
        : Math.max(0, timestamp - this.lastTimestamp);
    this.lastTimestamp = timestamp;
    this.callback(timestamp, deltaMs);
    if (this.running) {
      this.frameId = this.host.requestAnimationFrame(this.tick);
    }
  };
}
