import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyzeMotion,
  analyzeMovement,
  axisSeries,
  markTrustedInputSequence,
  requestWindows,
  restingTail,
  waitForEvidenceBeforeActionCompletion,
  type TrajectoryCapture,
  type TrajectoryFrame,
} from "./browser/navigation-trajectory";

const frameMs = 1000 / 60;
const timeConstantMs = 115;

function exponentialApproach(
  from: number,
  to: number,
  frames: number,
): number[] {
  const totalMs = frames * frameMs;
  const floor = Math.exp(-totalMs / timeConstantMs);
  return Array.from({ length: frames }, (_, index) => {
    const elapsedMs = (index + 1) * frameMs;
    const remaining =
      (Math.exp(-elapsedMs / timeConstantMs) - floor) / (1 - floor);
    return to + (from - to) * remaining;
  });
}

function frame(
  index: number,
  x: number,
  moving: boolean,
  overrides: Partial<TrajectoryFrame> = {},
): TrajectoryFrame {
  return {
    focusedPaneId: "tasks",
    moving,
    overviewProgress: "0.0000",
    panes: {
      tasks: {
        height: 400,
        moving,
        runtimeState: moving ? "frozen" : "live",
        visible: true,
        width: 500,
        x,
        y: 80,
      },
    },
    presentationMode: "normal",
    sampledAtMs: index * frameMs + 2,
    timeMs: index * frameMs,
    ...overrides,
  };
}

function settledMove(): TrajectoryCapture {
  const curve = exponentialApproach(448, 10, 44);
  const xs = [448, 448, 448, ...curve, 10, 10, 10, 10];
  const frames = xs.map((x, index) =>
    frame(index, x, index >= 3 && index < 3 + curve.length),
  );
  return {
    frames,
    marks: [{ label: "signals → tasks", timeMs: 1 * frameMs + 5 }],
  };
}

function onlyWindow(capture: TrajectoryCapture) {
  const [window] = requestWindows(capture);
  if (!window) {
    throw new Error("no request window");
  }
  return window;
}

describe("navigation trajectory analysis", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures an in-flight origin at the trusted event boundary", () => {
    let displayedX = 448;
    const eventTarget = new EventTarget() as EventTarget & {
      __onirigiriTrajectoryProbe: {
        capture: TrajectoryCapture;
        running: boolean;
      };
    };
    eventTarget.__onirigiriTrajectoryProbe = {
      capture: { frames: [], marks: [] },
      running: true,
    };
    vi.stubGlobal("window", eventTarget);
    vi.stubGlobal("document", {
      querySelectorAll: () => [
        {
          dataset: { onirigiriPaneId: "signals" },
          getBoundingClientRect: () => ({ x: displayedX }),
        },
      ],
    });

    markTrustedInputSequence([
      {
        eventType: "keydown",
        key: "ArrowRight",
        label: "signals → tasks",
        travelOriginPaneId: "signals",
      },
    ]);
    displayedX = 391;
    eventTarget.dispatchEvent(
      Object.assign(new Event("keydown"), { key: "ArrowRight" }),
    );

    expect(eventTarget.__onirigiriTrajectoryProbe.capture.marks).toEqual([
      {
        label: "signals → tasks",
        timeMs: expect.any(Number),
        travelOriginX: 391,
      },
    ]);
  });

  it("arms successive trusted-input marks before a rapid sequence", () => {
    let displayedX = 448;
    const eventTarget = new EventTarget() as EventTarget & {
      __onirigiriTrajectoryProbe: {
        capture: TrajectoryCapture;
        running: boolean;
      };
    };
    eventTarget.__onirigiriTrajectoryProbe = {
      capture: { frames: [], marks: [] },
      running: true,
    };
    vi.stubGlobal("window", eventTarget);
    vi.stubGlobal("document", {
      querySelectorAll: () => [
        {
          dataset: { onirigiriPaneId: "signals" },
          getBoundingClientRect: () => ({ x: displayedX }),
        },
      ],
    });

    markTrustedInputSequence([
      {
        eventType: "keydown",
        key: "ArrowRight",
        label: "signals → tasks",
        travelOriginPaneId: "signals",
      },
      {
        eventType: "keydown",
        key: "ArrowDown",
        label: "tasks → notes",
      },
    ]);
    eventTarget.dispatchEvent(
      Object.assign(new Event("keydown"), { key: "ArrowRight" }),
    );
    displayedX = 391;
    eventTarget.dispatchEvent(
      Object.assign(new Event("keydown"), { key: "ArrowDown" }),
    );

    expect(eventTarget.__onirigiriTrajectoryProbe.capture.marks).toEqual([
      {
        label: "signals → tasks",
        timeMs: expect.any(Number),
        travelOriginX: 448,
      },
      {
        label: "tasks → notes",
        timeMs: expect.any(Number),
      },
    ]);
  });

  it("reaches rapid evidence before traced action bookkeeping completes", async () => {
    let resolveAction: ((value: number) => void) | undefined;
    let resolveEvidence: (() => void) | undefined;
    const action = new Promise<number>((resolve) => {
      resolveAction = resolve;
    });
    const evidence = new Promise<void>((resolve) => {
      resolveEvidence = resolve;
    });
    const boundary = waitForEvidenceBeforeActionCompletion(evidence, action);

    resolveEvidence?.();
    const receipt = await boundary;
    resolveAction?.(42);

    await expect(receipt.complete()).resolves.toBe(42);
  });

  it("retains an action failure until its deferred receipt is completed", async () => {
    const failure = new Error("traced action failed");
    const receipt = await waitForEvidenceBeforeActionCompletion(
      Promise.resolve(),
      Promise.reject(failure),
    );

    await expect(receipt.complete()).rejects.toBe(failure);
  });

  it("accepts one continuous, monotonic, settled movement", () => {
    const window = onlyWindow(settledMove());
    const motion = analyzeMotion(axisSeries(window, "tasks", "x"));

    expect(window.previous?.timeMs).toBe(frameMs);
    expect(motion.directionChanges).toBe(0);
    expect(motion.midFlightStalls).toBe(0);
    expect(motion.movedAwayPx).toBe(0);
    expect(motion.distinctIntermediatePositions).toBeGreaterThanOrEqual(12);
    expect(motion.firstStepFraction).toBeLessThanOrEqual(0.5);
    expect(motion.largestVelocityGrowth).toBeLessThanOrEqual(1.01);
    expect(motion.travelPx).toBeCloseTo(438, 5);
    expect(analyzeMovement(window)).toEqual({
      movementStarts: 1,
      movingAtEnd: false,
      movingBefore: false,
      movingFrames: 44,
    });
    expect(restingTail(window, "tasks")).toEqual({
      movingFrames: 0,
      stationary: true,
    });
  });

  it("measures speed per animation millisecond so a dropped display frame is not a speed change", () => {
    const samples = exponentialApproach(448, 10, 30)
      .map((value, index) => ({ time: index * frameMs, value }))
      .filter((_, index) => index !== 6);
    const motion = analyzeMotion({
      times: samples.map(({ time }) => time),
      values: samples.map(({ value }) => value),
    });
    expect(motion.largestVelocityGrowth).toBeLessThanOrEqual(1.01);
    expect(motion.midFlightStalls).toBe(0);
  });

  it("does not read the store's terminal settle snap as a speed change", () => {
    const curve = exponentialApproach(857, 11.6, 44);
    const values = [857, ...curve, 10, 10, 10, 10];
    const motion = analyzeMotion({
      times: values.map((_, index) => index * frameMs),
      values,
    });
    expect(motion.travelPx).toBe(847);
    expect(motion.largestVelocityGrowth).toBeLessThanOrEqual(1.01);
    expect(motion.midFlightStalls).toBe(0);
    expect(motion.directionChanges).toBe(0);
  });

  it("fails a direct endpoint jump and a snap-then-ease", () => {
    const jump = analyzeMotion({
      times: [0, 1, 2, 3, 4].map((index) => index * frameMs),
      values: [448, 448, 10, 10, 10],
    });
    expect(jump.distinctIntermediatePositions).toBe(0);
    expect(jump.firstStepFraction).toBe(1);

    const snapped = [448, 448, 60, ...exponentialApproach(60, 10, 30), 10, 10];
    const snapThenEase = analyzeMotion({
      times: snapped.map((_, index) => index * frameMs),
      values: snapped,
    });
    expect(snapThenEase.distinctIntermediatePositions).toBeGreaterThan(12);
    expect(snapThenEase.firstStepFraction).toBeGreaterThan(0.5);
  });

  it("flags a movement that settles and restarts inside one request as a duplicate leg", () => {
    const first = exponentialApproach(538, 411, 8);
    const second = exponentialApproach(411, 10, 30);
    const xs = [538, 538, ...first, 411, ...second, 10, 10];
    const frames = xs.map((x, index) => {
      const inFirst = index >= 2 && index < 2 + first.length;
      const inSecond =
        index > 2 + first.length && index <= 2 + first.length + second.length;
      return frame(index, x, inFirst || inSecond);
    });
    const window = onlyWindow({
      frames,
      marks: [{ label: "atlas → system", timeMs: frameMs + 5 }],
    });

    const motion = analyzeMotion(axisSeries(window, "tasks", "x"));
    expect(analyzeMovement(window)).toMatchObject({
      movementStarts: 2,
      movingBefore: false,
    });
    expect(motion.midFlightStalls).toBe(1);
  });

  it("recognises an in-flight continuation that never rests", () => {
    const curve = exponentialApproach(300, 10, 30);
    const frames = [
      frame(0, 340, true),
      ...curve.map((x, index) => frame(index + 1, x, true)),
      frame(curve.length + 1, 10, false),
      frame(curve.length + 2, 10, false),
      frame(curve.length + 3, 10, false),
    ];
    const window = onlyWindow({
      frames,
      marks: [{ label: "tasks → atlas (rapid)", timeMs: 5 }],
    });
    expect(analyzeMovement(window)).toEqual({
      movementStarts: 0,
      movingAtEnd: false,
      movingBefore: true,
      movingFrames: curve.length,
    });
    expect(restingTail(window, "tasks")).toEqual({
      movingFrames: 0,
      stationary: true,
    });
  });

  it("fails a retarget that jumps instead of continuing from the displayed frame", () => {
    const values = [734, 512, 432, 352, 272, 192];
    const motion = analyzeMotion({
      times: values.map((_, index) => index * frameMs),
      values,
    });
    expect(motion.firstStepGrowth).toBeCloseTo(222 / 80, 5);
    expect(motion.largestVelocityGrowth).toBeLessThanOrEqual(1.01);

    const continued = [734, 734, 654, 574, 494, 414];
    expect(
      analyzeMotion({
        times: continued.map((_, index) => index * frameMs),
        values: continued,
      }).firstStepGrowth,
    ).toBeCloseTo(1, 5);
  });

  it("fails a reversal that moves away from its endpoint before returning", () => {
    const values = [-337, -684, -600, -500, -380, -240, -100, 10, 10];
    const motion = analyzeMotion({
      times: values.map((_, index) => index * frameMs),
      values,
    });
    expect(motion.directionChanges).toBe(1);
    expect(motion.movedAwayPx).toBeCloseTo(347, 5);
  });

  it("describes a reduced-motion snap as no movement and no intermediate position", () => {
    const frames = [
      frame(0, 448, false),
      frame(1, 448, false),
      frame(2, 10, false),
      frame(3, 10, false),
      frame(4, 10, false),
    ];
    const window = onlyWindow({
      frames,
      marks: [
        { label: "signals → tasks (reduced motion)", timeMs: frameMs + 5 },
      ],
    });
    const motion = analyzeMotion(axisSeries(window, "tasks", "x"));
    expect(analyzeMovement(window).movementStarts).toBe(0);
    expect(motion.distinctIntermediatePositions).toBe(0);
    expect(motion.travelPx).toBe(438);
  });

  it("assigns frames to requests by sampling time and keeps the prior frame", () => {
    const frames = [
      frame(0, 1, false),
      frame(1, 2, false),
      frame(2, 3, false),
      frame(3, 4, false),
    ];
    const windows = requestWindows({
      frames,
      marks: [
        { label: "second", timeMs: 2 * frameMs + 1 },
        { label: "first", timeMs: frameMs + 1 },
      ],
    });
    expect(windows.map((window) => window.label)).toEqual(["first", "second"]);
    expect(windows[0]?.previous?.timeMs).toBe(0);
    expect(windows[0]?.frames.map((entry) => entry.timeMs)).toEqual([frameMs]);
    expect(windows[1]?.previous?.timeMs).toBe(frameMs);
    expect(windows[1]?.frames.map((entry) => entry.timeMs)).toEqual([
      2 * frameMs,
      3 * frameMs,
    ]);
  });
});
