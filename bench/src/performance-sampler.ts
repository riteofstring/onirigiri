import type {
  PerformanceLongTaskSample,
  PerformanceMetricSummary,
} from "./performance-types";

interface BrowserPerformanceObservation {
  frameDeltasMs: readonly number[];
  longTasks: readonly PerformanceLongTaskSample[];
  movingFrameDeltasMs: readonly number[];
  movingVisiblePaneCounts: readonly number[];
}

export class BrowserPerformanceSampler {
  private animationFrame: number | null = null;
  private readonly frameDeltasMs: number[] = [];
  private readonly longTasks: PerformanceLongTaskSample[] = [];
  private readonly movingFrameDeltasMs: number[] = [];
  private readonly movingVisiblePaneCounts: number[] = [];
  private longTaskObserver: PerformanceObserver | null = null;
  private previousFrameMoving = false;
  private previousFrameTime: number | null = null;

  start(): void {
    this.startLongTaskObserver();
    this.animationFrame = requestAnimationFrame((time) =>
      this.recordFrame(time),
    );
  }

  stop(): BrowserPerformanceObservation {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.longTaskObserver) {
      this.consumeLongTasks(this.longTaskObserver.takeRecords());
      this.longTaskObserver.disconnect();
      this.longTaskObserver = null;
    }
    return {
      frameDeltasMs: this.frameDeltasMs,
      longTasks: this.longTasks,
      movingFrameDeltasMs: this.movingFrameDeltasMs,
      movingVisiblePaneCounts: this.movingVisiblePaneCounts,
    };
  }

  private recordFrame(time: number): void {
    const moving = workspaceIsMoving();
    if (moving) {
      const count = visiblePaneCount();
      if (count > 0) {
        this.movingVisiblePaneCounts.push(count);
      }
    }
    if (this.previousFrameTime !== null) {
      const duration = time - this.previousFrameTime;
      this.frameDeltasMs.push(duration);
      if (this.previousFrameMoving || moving) {
        this.movingFrameDeltasMs.push(duration);
      }
    }
    this.previousFrameTime = time;
    this.previousFrameMoving = moving;
    this.animationFrame = requestAnimationFrame((nextTime) =>
      this.recordFrame(nextTime),
    );
  }

  private startLongTaskObserver(): void {
    if (
      typeof PerformanceObserver === "undefined" ||
      !PerformanceObserver.supportedEntryTypes.includes("longtask")
    ) {
      return;
    }
    this.longTaskObserver = new PerformanceObserver((list) => {
      this.consumeLongTasks(list.getEntries());
    });
    this.longTaskObserver.observe({ entryTypes: ["longtask"] });
  }

  private consumeLongTasks(entries: readonly PerformanceEntry[]): void {
    for (const entry of entries) {
      this.longTasks.push({
        durationMs: entry.duration,
        startTimeMs: entry.startTime,
      });
    }
  }
}

function visiblePaneCount(): number {
  return document.querySelectorAll(
    '[data-onirigiri-slot="pane"][data-visible="true"]',
  ).length;
}

function workspaceIsMoving(): boolean {
  return (
    document.querySelector(
      '[data-onirigiri-slot="pane"][data-moving="true"]',
    ) !== null
  );
}

export async function sampleObservedRefreshInterval(
  frameCount = 45,
): Promise<number> {
  const deltas: number[] = [];
  let previousTime: number | null = null;
  while (deltas.length < frameCount) {
    const time = await nextAnimationFrame();
    if (previousTime !== null) {
      deltas.push(time - previousTime);
    }
    previousTime = time;
  }
  return summarizeDurations(deltas).p50 || 1000 / 60;
}

export function summarizeDurations(
  values: readonly number[],
): PerformanceMetricSummary {
  if (values.length === 0) {
    return { count: 0, maximum: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    maximum: sorted.at(-1) ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

export function waitForDisplayFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const advance = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => advance(remaining - 1));
    };
    advance(count);
  });
}

function percentile(sortedValues: readonly number[], quantile: number): number {
  const rank = Math.max(1, Math.ceil(quantile * sortedValues.length));
  return sortedValues[rank - 1] ?? 0;
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
