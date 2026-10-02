import type { stopPerformanceWorkRecording } from "./performance-frame-work";
import type { BrowserPerformanceSampler } from "./performance-sampler";

export function performanceSamples(
  observation: ReturnType<BrowserPerformanceSampler["stop"]>,
  performanceWork: ReturnType<typeof stopPerformanceWorkRecording>,
) {
  return {
    allAnimationFrameWorkMs: performanceWork.animationFrameWorkMs,
    allBrowserFrameDeltasMs: observation.frameDeltasMs,
    animationFrameWorkMs: performanceWork.animationFrameWorkMs,
    browserFrameDeltasMs: observation.frameDeltasMs,
    onirigiriBoundaries: performanceWork.onirigiriBoundaries,
  };
}

export function minimumMovingVisiblePanes(
  counts: readonly number[],
): number | null {
  return counts.length ? Math.min(...counts) : null;
}
