export const performanceScenarioIds = [
  "navigation-50",
  "overview-100",
  "overview-500",
  "asymmetric-48",
  "mixed-content-36",
  "background-cache-100",
  "live-navigation-100",
  "live-overview-100",
] as const;

export type PerformanceScenarioId = (typeof performanceScenarioIds)[number];

export interface PerformanceMetricSummary {
  count: number;
  maximum: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface PerformanceLongTaskSample {
  durationMs: number;
  startTimeMs: number;
}

export interface PerformanceSlowFrameInterval {
  durationMs: number;
  endTimeMs: number;
  index: number;
  startTimeMs: number;
}

export interface PerformanceDiagnosticTrace {
  slowFrameIntervals: readonly PerformanceSlowFrameInterval[];
}

export interface PerformanceOnirigiriBoundarySample {
  boundaryWorkDurationMs: number;
  reactCommitCount: number;
  reactWorkDurationMs: number;
  requestCount: number;
  requestHandlerWorkDurationMs: number;
}

export interface PerformanceScenarioResult {
  counts: {
    framesOver50Ms: number;
    longTasks: number;
    minimumMovingVisiblePanes: number | null;
    mountedPanes: number;
    visibleLivePanes: number;
    visiblePanes: number;
  };
  display: {
    devicePixelRatio: number;
    observedRefreshIntervalMs: number;
    viewport: { height: number; width: number };
  };
  diagnosticTrace?: PerformanceDiagnosticTrace;
  iterations: number;
  label: string;
  paneCount: number;
  productionBuild: boolean;
  samples: {
    allAnimationFrameWorkMs: readonly number[];
    allBrowserFrameDeltasMs: readonly number[];
    animationFrameWorkMs: readonly number[];
    browserFrameDeltasMs: readonly number[];
    longTasks: readonly PerformanceLongTaskSample[];
    onirigiriBoundaries: readonly PerformanceOnirigiriBoundarySample[];
  };
  scenarioId: PerformanceScenarioId;
  summaries: {
    allAnimationFrameWorkMs: PerformanceMetricSummary;
    allBrowserFrameDeltaMs: PerformanceMetricSummary;
    animationFrameWorkMs: PerformanceMetricSummary;
    browserFrameDeltaMs: PerformanceMetricSummary;
    longTaskDurationMs: PerformanceMetricSummary;
    onirigiriBoundaryWorkDurationMs: PerformanceMetricSummary;
    reactWorkDurationMs: PerformanceMetricSummary;
    requestHandlerWorkDurationMs: PerformanceMetricSummary;
  };
}

interface OnirigiriPerformanceFixtureApi {
  productionBuild: boolean;
  run(): Promise<PerformanceScenarioResult>;
  scenarioId: PerformanceScenarioId;
}

declare global {
  interface Window {
    __onirigiriPerformance?: OnirigiriPerformanceFixtureApi;
  }
}
