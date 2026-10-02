import { describe, expect, it, vi } from "vitest";

import {
  PerformanceDiagnosticTraceSampler,
  performanceDiagnosticTraceIsEnabled,
  performanceDiagnosticTraceQuery,
  slowFrameTraceMeasureName,
} from "../../bench/src/performance-diagnostic-trace";

describe("performance diagnostic trace sampler", () => {
  it("requires the browser-test-only query", () => {
    expect(performanceDiagnosticTraceIsEnabled("")).toBe(false);
    expect(
      performanceDiagnosticTraceIsEnabled("?onirigiri-cdp-trace=anything-else"),
    ).toBe(false);
    expect(
      performanceDiagnosticTraceIsEnabled(
        `?${performanceDiagnosticTraceQuery}=1`,
      ),
    ).toBe(true);
  });

  it("marks and returns only exact measured intervals over 50ms", () => {
    const callbacks: FrameRequestCallback[] = [];
    let animationFrame = 0;
    const frameHost = {
      cancelAnimationFrame: vi.fn(),
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback);
        animationFrame += 1;
        return animationFrame;
      }),
    };
    const userTiming = {
      mark: vi.fn(),
      measure: vi.fn(),
    };
    const sampler = new PerformanceDiagnosticTraceSampler(
      frameHost,
      userTiming,
    );

    sampler.start();
    runFrame(callbacks, 100);
    runFrame(callbacks, 149.9);
    runFrame(callbacks, 200);

    const trace = sampler.stop();
    const measureName = slowFrameTraceMeasureName(1);
    expect(trace.slowFrameIntervals).toHaveLength(1);
    expect(trace.slowFrameIntervals[0]).toMatchObject({
      endTimeMs: 200,
      index: 1,
      startTimeMs: 149.9,
    });
    expect(trace.slowFrameIntervals[0]?.durationMs).toBeCloseTo(50.1);
    expect(userTiming.mark).toHaveBeenCalledWith(`${measureName}-start`, {
      startTime: 149.9,
    });
    expect(userTiming.mark).toHaveBeenCalledWith(`${measureName}-end`, {
      startTime: 200,
    });
    expect(userTiming.measure).toHaveBeenCalledWith(measureName, {
      end: `${measureName}-end`,
      start: `${measureName}-start`,
    });
  });
});

function runFrame(callbacks: FrameRequestCallback[], time: number): void {
  const callback = callbacks.shift();
  if (!callback) {
    throw new Error("Expected an animation-frame callback.");
  }
  callback(time);
}
