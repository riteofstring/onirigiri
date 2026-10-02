import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  installAnimationFrameWorkMeter,
  measureOnirigiriRequestWork,
  recordReactBoundaryWork,
  startPerformanceWorkRecording,
  stopPerformanceWorkRecording,
} from "../../bench/src/performance-frame-work";

describe("performance work meter", () => {
  const nativeFrameCallbacks: FrameRequestCallback[] = [];
  let frameId = 0;
  let nowMs = 0;
  let restorePerformanceNow: (() => void) | null = null;

  beforeAll(() => {
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        nativeFrameCallbacks.push(callback);
        frameId += 1;
        return frameId;
      },
      writable: true,
    });
    installAnimationFrameWorkMeter();
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    restorePerformanceNow = () => nowSpy.mockRestore();
  });

  beforeEach(() => {
    nativeFrameCallbacks.length = 0;
    nowMs = 0;
  });

  afterAll(() => {
    restorePerformanceNow?.();
  });

  it("sums every callback in a display frame and keeps subsequent frames separate", () => {
    startPerformanceWorkRecording();
    window.requestAnimationFrame(() => {
      nowMs += 2;
    });
    window.requestAnimationFrame(() => {
      nowMs += 3;
    });
    window.requestAnimationFrame(() => {
      nowMs += 4;
    });
    nativeFrameCallbacks.shift()!(16);
    nativeFrameCallbacks.shift()!(16);
    nativeFrameCallbacks.shift()!(32);

    expect(stopPerformanceWorkRecording().animationFrameWorkMs).toEqual([5, 4]);
  });

  it("combines a synchronous request with asynchronous React work in the same frame", () => {
    startPerformanceWorkRecording();
    nowMs = 1;

    const result = measureOnirigiriRequestWork(() => {
      nowMs = 4;
      return "requested";
    });
    recordReactBoundaryWork(2);

    expect(result).toBe("requested");
    expect(stopPerformanceWorkRecording().onirigiriBoundaries).toEqual([
      {
        boundaryWorkDurationMs: 5,
        reactCommitCount: 1,
        reactWorkDurationMs: 2,
        requestCount: 1,
        requestHandlerWorkDurationMs: 3,
      },
    ]);
  });

  it("does not double-count React work committed inside the request call", () => {
    startPerformanceWorkRecording();
    nowMs = 10;

    measureOnirigiriRequestWork(() => {
      nowMs = 11;
      recordReactBoundaryWork(2);
      nowMs = 14;
    });

    expect(stopPerformanceWorkRecording().onirigiriBoundaries).toEqual([
      {
        boundaryWorkDurationMs: 4,
        reactCommitCount: 1,
        reactWorkDurationMs: 2,
        requestCount: 1,
        requestHandlerWorkDurationMs: 2,
      },
    ]);
  });

  it("keeps work from different display-frame epochs as separate boundaries", () => {
    startPerformanceWorkRecording();
    nowMs = 20;
    measureOnirigiriRequestWork(() => {
      nowMs = 23;
    });

    window.requestAnimationFrame(() => undefined);
    const nextFrame = nativeFrameCallbacks.shift();
    expect(nextFrame).toBeDefined();
    nowMs = 30;
    nextFrame?.(16);
    recordReactBoundaryWork(2);

    expect(stopPerformanceWorkRecording().onirigiriBoundaries).toEqual([
      {
        boundaryWorkDurationMs: 3,
        reactCommitCount: 0,
        reactWorkDurationMs: 0,
        requestCount: 1,
        requestHandlerWorkDurationMs: 3,
      },
      {
        boundaryWorkDurationMs: 2,
        reactCommitCount: 1,
        reactWorkDurationMs: 2,
        requestCount: 0,
        requestHandlerWorkDurationMs: 0,
      },
    ]);
  });
});
