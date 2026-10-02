import type { PerformanceScenarioResult } from "../../bench/src/performance-types";

export const target120HzFrameMs = 1000 / 120;
export const maximum60HzMeanFrameMs = 1000 / 60 + 0.1;

const maximum60HzRefreshIntervalMs = (1000 / 60) * 1.1;
const maximumSlowFrameRatio = 0.08;
const p95CadenceMultiplier = 1.35;
const p99CadenceMultiplier = 2;
const slowFrameMultiplier = 1.25;

export interface PerformanceBudgetAssessment {
  browserCadenceBudgetMs: number;
  cpuWorkBudgetMs: number;
  slowFrameRatio: number;
  violations: readonly string[];
}

export function assessPerformanceBudget(
  result: PerformanceScenarioResult,
): PerformanceBudgetAssessment {
  const browserCadenceBudgetMs = result.display.observedRefreshIntervalMs;
  const browserFrames = result.samples.browserFrameDeltasMs;
  const slowFrameRatio = slowFrameRatioFor(
    browserFrames,
    browserCadenceBudgetMs,
  );
  const violations = [
    ...sampleIntegrityViolations(result, browserCadenceBudgetMs),
    ...cadenceViolations(result, browserCadenceBudgetMs, slowFrameRatio),
    ...cpuWorkViolations(result),
  ];
  return {
    browserCadenceBudgetMs,
    cpuWorkBudgetMs: target120HzFrameMs,
    slowFrameRatio,
    violations,
  };
}

function sampleIntegrityViolations(
  result: PerformanceScenarioResult,
  browserCadenceBudgetMs: number,
): string[] {
  const violations: string[] = [];
  if (!Number.isFinite(browserCadenceBudgetMs) || browserCadenceBudgetMs <= 0) {
    violations.push(
      "observed refresh interval must be a positive finite number",
    );
  }
  if (browserCadenceBudgetMs > maximum60HzRefreshIntervalMs) {
    violations.push(
      `observed refresh interval ${formatMs(browserCadenceBudgetMs)} missed the 60Hz minimum`,
    );
  }
  if (result.samples.browserFrameDeltasMs.length < 20) {
    violations.push(
      `expected at least 20 display frames, received ${result.samples.browserFrameDeltasMs.length}`,
    );
  }
  if (result.counts.longTasks !== 0) {
    violations.push(
      `expected no long tasks, received ${result.counts.longTasks}`,
    );
  }
  if (result.counts.framesOver50Ms !== 0) {
    violations.push(
      `expected no display frames over 50ms, received ${result.counts.framesOver50Ms}`,
    );
  }
  return violations;
}

function cadenceViolations(
  result: PerformanceScenarioResult,
  browserCadenceBudgetMs: number,
  slowFrameRatio: number,
): string[] {
  const violations: string[] = [];
  const frames = result.samples.browserFrameDeltasMs;
  if (frames.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    violations.push("display frame durations must be positive finite numbers");
  }
  const meanFrameMs =
    frames.reduce((total, duration) => total + duration, 0) / frames.length;
  const maximumMeanFrameMs = Math.min(
    maximum60HzMeanFrameMs,
    browserCadenceBudgetMs + 0.1,
  );
  if (meanFrameMs > maximumMeanFrameMs) {
    violations.push(
      `measured display cadence ${formatMs(meanFrameMs)} exceeded ${formatMs(maximumMeanFrameMs)} for the observed refresh rate and 60Hz minimum`,
    );
  }
  if (slowFrameRatio > maximumSlowFrameRatio) {
    violations.push(
      `slow-frame ratio ${formatRatio(slowFrameRatio)} exceeded ${formatRatio(maximumSlowFrameRatio)}`,
    );
  }
  const browserP95LimitMs = browserCadenceBudgetMs * p95CadenceMultiplier;
  if (result.summaries.browserFrameDeltaMs.p95 > browserP95LimitMs) {
    violations.push(
      `display p95 ${formatMs(result.summaries.browserFrameDeltaMs.p95)} exceeded ${formatMs(browserP95LimitMs)}`,
    );
  }
  const browserP99LimitMs = Math.max(
    browserCadenceBudgetMs * p99CadenceMultiplier,
    24,
  );
  if (result.summaries.browserFrameDeltaMs.p99 > browserP99LimitMs) {
    violations.push(
      `display p99 ${formatMs(result.summaries.browserFrameDeltaMs.p99)} exceeded ${formatMs(browserP99LimitMs)}`,
    );
  }
  return violations;
}

function cpuWorkViolations(result: PerformanceScenarioResult): string[] {
  const violations: string[] = [];
  const frameWork = result.summaries.animationFrameWorkMs;
  if (frameWork.count === 0) {
    violations.push(
      "expected animation-frame work samples during the workload",
    );
  }
  if (frameWork.p95 > target120HzFrameMs) {
    violations.push(
      `Onirigiri frame work p95 ${formatMs(frameWork.p95)} exceeded the 120Hz CPU budget ${formatMs(target120HzFrameMs)}`,
    );
  }
  if (frameWork.p99 > target120HzFrameMs * 2) {
    violations.push(
      `Onirigiri frame work p99 ${formatMs(frameWork.p99)} exceeded ${formatMs(target120HzFrameMs * 2)}`,
    );
  }
  const boundaryWork = result.summaries.onirigiriBoundaryWorkDurationMs;
  if (boundaryWork.count === 0) {
    violations.push(
      "expected measured Onirigiri boundaries during the workload",
    );
  }
  if (result.summaries.requestHandlerWorkDurationMs.count === 0) {
    violations.push(
      "expected synchronous Onirigiri request-handler samples during the workload",
    );
  }
  if (result.summaries.reactWorkDurationMs.count === 0) {
    violations.push("expected React boundary samples during the workload");
  }
  if (boundaryWork.p95 > target120HzFrameMs) {
    violations.push(
      `Onirigiri boundary work p95 ${formatMs(boundaryWork.p95)} exceeded the 120Hz CPU budget ${formatMs(target120HzFrameMs)}`,
    );
  }
  if (boundaryWork.p99 > target120HzFrameMs * 2) {
    violations.push(
      `Onirigiri boundary work p99 ${formatMs(boundaryWork.p99)} exceeded ${formatMs(target120HzFrameMs * 2)}`,
    );
  }
  return violations;
}

function slowFrameRatioFor(
  browserFrames: readonly number[],
  browserCadenceBudgetMs: number,
): number {
  if (browserFrames.length === 0) {
    return 1;
  }
  const slowFrameThresholdMs = browserCadenceBudgetMs * slowFrameMultiplier;
  const slowFrameCount = browserFrames.filter(
    (duration) => duration > slowFrameThresholdMs,
  ).length;
  return slowFrameCount / browserFrames.length;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
