import type {
  PerformanceDiagnosticTrace,
  PerformanceSlowFrameInterval,
} from "./performance-types";

export const performanceDiagnosticTraceQuery = "onirigiri-cdp-trace";

const slowFrameMeasurePrefix = "onirigiri-cdp-slow-frame";
const slowFrameThresholdMs = 50;

interface AnimationFrameHost {
  cancelAnimationFrame(handle: number): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
}

interface UserTimingHost {
  mark(name: string, options?: PerformanceMarkOptions): void;
  measure(name: string, options: PerformanceMeasureOptions): void;
}

export function performanceDiagnosticTraceIsEnabled(search: string): boolean {
  return (
    new URLSearchParams(search).get(performanceDiagnosticTraceQuery) === "1"
  );
}

export function slowFrameTraceMeasureName(index: number): string {
  return `${slowFrameMeasurePrefix}-${index}`;
}

export class PerformanceDiagnosticTraceSampler {
  private animationFrame: number | null = null;
  private previousFrameTime: number | null = null;
  private readonly slowFrameIntervals: PerformanceSlowFrameInterval[] = [];
  private started = false;

  constructor(
    private readonly frameHost: AnimationFrameHost = window,
    private readonly userTiming: UserTimingHost = performance,
  ) {}

  start(): void {
    if (this.started) {
      throw new Error("Diagnostic trace sampling is already active.");
    }
    this.started = true;
    this.animationFrame = this.frameHost.requestAnimationFrame(
      this.recordFrame,
    );
  }

  stop(): PerformanceDiagnosticTrace {
    if (!this.started) {
      throw new Error("Diagnostic trace sampling is not active.");
    }
    if (this.animationFrame !== null) {
      this.frameHost.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.started = false;
    return { slowFrameIntervals: [...this.slowFrameIntervals] };
  }

  private readonly recordFrame = (time: number): void => {
    if (this.previousFrameTime !== null) {
      const interval = {
        durationMs: time - this.previousFrameTime,
        endTimeMs: time,
        index: this.slowFrameIntervals.length + 1,
        startTimeMs: this.previousFrameTime,
      };
      if (interval.durationMs > slowFrameThresholdMs) {
        this.slowFrameIntervals.push(interval);
        this.recordSlowFrameMeasure(interval);
      }
    }
    this.previousFrameTime = time;
    this.animationFrame = this.frameHost.requestAnimationFrame(
      this.recordFrame,
    );
  };

  private recordSlowFrameMeasure(interval: PerformanceSlowFrameInterval): void {
    const measureName = slowFrameTraceMeasureName(interval.index);
    const startMark = `${measureName}-start`;
    const endMark = `${measureName}-end`;
    this.userTiming.mark(startMark, { startTime: interval.startTimeMs });
    this.userTiming.mark(endMark, { startTime: interval.endTimeMs });
    this.userTiming.measure(measureName, { end: endMark, start: startMark });
  }
}
