import { describe, expect, it } from "vitest";

import type { PerformanceScenarioResult } from "../../bench/src/performance-types";
import { assessPerformanceBudget, target120HzFrameMs } from "./frame-budget";

describe("assessPerformanceBudget", () => {
  it("accepts healthy cadence and 120Hz-ready Onirigiri work", () => {
    const result = performanceResult();

    expect(assessPerformanceBudget(result)).toMatchObject({
      browserCadenceBudgetMs: 16.67,
      cpuWorkBudgetMs: target120HzFrameMs,
      slowFrameRatio: 0,
      violations: [],
    });
  });

  it("reports dropped frames, long tasks, and CPU budget regressions", () => {
    const result = performanceResult({
      browserFrames: [...Array.from({ length: 18 }, () => 16.67), 32, 55],
      boundaryWorkDurations: [4, 8, 9, 20],
      frameWorkDurations: [1, 2, 9, 20],
      longTaskCount: 1,
    });

    expect(assessPerformanceBudget(result).violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("long tasks"),
        expect.stringContaining("frames over 50ms"),
        expect.stringContaining("slow-frame ratio"),
        expect.stringContaining("Onirigiri frame work p95"),
        expect.stringContaining("Onirigiri frame work p99"),
        expect.stringContaining("Onirigiri boundary work p95"),
        expect.stringContaining("Onirigiri boundary work p99"),
      ]),
    );
  });

  it("holds per-frame Onirigiri work to the 120Hz tier even when React boundaries are cheap", () => {
    const result = performanceResult({
      boundaryWorkDurations: [1, 1, 2, 2],
      frameWorkDurations: [...Array.from({ length: 20 }, () => 3), 9, 9],
    });

    expect(assessPerformanceBudget(result).violations).toEqual([
      expect.stringContaining("Onirigiri frame work p95 9.00ms"),
    ]);
  });

  it("rejects slow mutation and layout-effect work when render CPU is cheap", () => {
    const result = performanceResult({
      boundaryWorkDurations: Array.from({ length: 20 }, () => 9),
      reactWorkDurations: Array.from({ length: 20 }, () => 9),
    });

    expect(assessPerformanceBudget(result).violations).toEqual([
      expect.stringContaining("Onirigiri boundary work p95 9.00ms"),
    ]);
  });

  it("rejects slow synchronous requests even at a measured 60Hz cadence", () => {
    const result = performanceResult({
      boundaryWorkDurations: Array.from({ length: 20 }, () => 9),
      reactWorkDurations: Array.from({ length: 20 }, () => 0),
      requestHandlerWorkDurations: Array.from({ length: 20 }, () => 9),
    });

    expect(assessPerformanceBudget(result).violations).toEqual([
      expect.stringContaining("Onirigiri boundary work p95 9.00ms"),
    ]);
  });

  it("rejects an adaptive browser cadence below the 60Hz floor", () => {
    const result = performanceResult({
      browserFrames: Array.from({ length: 24 }, () => 33.33),
      observedRefreshIntervalMs: 33.33,
    });

    expect(assessPerformanceBudget(result).violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("observed refresh interval"),
        expect.stringContaining("measured display cadence"),
      ]),
    );
  });

  it("rejects reduced throughput even when percentile and slow-frame allowances pass", () => {
    const result = performanceResult({
      browserFrames: [...Array.from({ length: 98 }, () => 16.67), 33.33, 33.33],
    });
    expect(assessPerformanceBudget(result).violations).toEqual([
      expect.stringContaining("measured display cadence"),
    ]);
  });

  it.each([120, 144, 240])(
    "requires sustained delivery at an observed %sHz",
    (rate) => {
      const interval = 1000 / rate;
      const healthy = performanceResult({
        browserFrames: Array.from({ length: 100 }, () => interval),
        observedRefreshIntervalMs: interval,
      });
      expect(assessPerformanceBudget(healthy).violations).toEqual([]);
      const missed = performanceResult({
        browserFrames: [
          ...Array.from({ length: 97 }, () => interval),
          ...Array.from({ length: 3 }, () => interval * 2),
        ],
        observedRefreshIntervalMs: interval,
      });
      expect(assessPerformanceBudget(missed).violations).toEqual([
        expect.stringContaining("measured display cadence"),
      ]);
    },
  );

  it.each([NaN, Infinity, -1, 0])(
    "rejects invalid display timing %s",
    (duration) => {
      const result = performanceResult({
        browserFrames: [...Array.from({ length: 24 }, () => 16.67), duration],
      });
      expect(assessPerformanceBudget(result).violations).toContain(
        "display frame durations must be positive finite numbers",
      );
    },
  );

  it("rejects samples that cannot prove a useful workload", () => {
    const result = performanceResult({
      browserFrames: [16.67],
      boundaryWorkDurations: [],
      frameWorkDurations: [],
    });

    expect(assessPerformanceBudget(result).violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("at least 20 display frames"),
        expect.stringContaining("animation-frame work samples"),
        expect.stringContaining("measured Onirigiri boundaries"),
        expect.stringContaining("request-handler samples"),
        expect.stringContaining("React boundary samples"),
      ]),
    );
  });
});

function performanceResult(
  options: {
    boundaryWorkDurations?: number[];
    browserFrames?: number[];
    frameWorkDurations?: number[];
    longTaskCount?: number;
    observedRefreshIntervalMs?: number;
    reactWorkDurations?: number[];
    requestCounts?: number[];
    requestHandlerWorkDurations?: number[];
  } = {},
): PerformanceScenarioResult {
  const browserFrames = valueOr(options.browserFrames, () =>
    Array.from({ length: 24 }, () => 16.67),
  );
  const boundaryWorkDurations = valueOr(options.boundaryWorkDurations, () => [
    2, 3, 4, 5,
  ]);
  const reactWorkDurations = valueOr(options.reactWorkDurations, () =>
    boundaryWorkDurations.map((duration, index) =>
      Math.max(
        0,
        duration - (options.requestHandlerWorkDurations?.[index] ?? 0),
      ),
    ),
  );
  const requestHandlerWorkDurations = valueOr(
    options.requestHandlerWorkDurations,
    () =>
      boundaryWorkDurations.map((duration, index) =>
        Math.max(0, duration - (reactWorkDurations[index] ?? 0)),
      ),
  );
  const frameWorkDurations = valueOr(options.frameWorkDurations, () =>
    Array.from({ length: 24 }, () => 1.5),
  );
  const longTaskCount = valueOr(options.longTaskCount, () => 0);
  return {
    counts: {
      framesOver50Ms: browserFrames.filter((duration) => duration > 50).length,
      longTasks: longTaskCount,
      minimumMovingVisiblePanes: null,
      mountedPanes: 8,
      visibleLivePanes: 4,
      visiblePanes: 4,
    },
    display: {
      devicePixelRatio: 1,
      observedRefreshIntervalMs: valueOr(
        options.observedRefreshIntervalMs,
        () => 16.67,
      ),
      viewport: { height: 900, width: 1_280 },
    },
    iterations: 3,
    label: "test fixture",
    paneCount: 8,
    productionBuild: true,
    samples: {
      allAnimationFrameWorkMs: frameWorkDurations,
      allBrowserFrameDeltasMs: browserFrames,
      animationFrameWorkMs: frameWorkDurations,
      browserFrameDeltasMs: browserFrames,
      longTasks: Array.from({ length: longTaskCount }, () => ({
        durationMs: 51,
        startTimeMs: 1,
      })),
      onirigiriBoundaries: boundaryWorkDurations.map(
        (boundaryWorkDurationMs, index) => {
          return {
            boundaryWorkDurationMs,
            reactCommitCount: 1,
            reactWorkDurationMs: reactWorkDurations[index] ?? 0,
            requestCount: options.requestCounts?.[index] ?? 1,
            requestHandlerWorkDurationMs:
              requestHandlerWorkDurations[index] ?? 0,
          };
        },
      ),
    },
    scenarioId: "navigation-50",
    summaries: {
      allAnimationFrameWorkMs: durationSummary(frameWorkDurations),
      allBrowserFrameDeltaMs: durationSummary(browserFrames),
      animationFrameWorkMs: durationSummary(frameWorkDurations),
      browserFrameDeltaMs: durationSummary(browserFrames),
      longTaskDurationMs: durationSummary(
        Array.from({ length: longTaskCount }, () => 51),
      ),
      onirigiriBoundaryWorkDurationMs: durationSummary(boundaryWorkDurations),
      reactWorkDurationMs: durationSummary(reactWorkDurations),
      requestHandlerWorkDurationMs: durationSummary(
        requestHandlerWorkDurations,
      ),
    },
  };
}

function valueOr<Value>(
  value: Value | undefined,
  fallback: () => Value,
): Value {
  return value === undefined ? fallback() : value;
}

function durationSummary(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (quantile: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
  return {
    count: sorted.length,
    maximum: sorted.at(-1) ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}
