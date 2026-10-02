import { describe, expect, it } from "vitest";

import {
  defaultCameraMotion,
  resolveCameraMotion,
} from "../src/presentation/motion-curve";
import { WorkspaceCameraMotion } from "../src/state/layout-store-animation";

const settled = {
  horizontalAnchorOffset: 0,
  overviewProgress: 0,
  scrollColumn: 0,
  scrollRow: 0,
  targetHorizontalAnchorOffset: 0,
  targetOverviewProgress: 0,
  targetScrollColumn: 0,
  targetScrollRow: 0,
  targetVerticalAnchorOffset: 0,
  verticalAnchorOffset: 0,
};

function workspaceCameraAnimationFrame(
  input: Parameters<WorkspaceCameraMotion["advance"]>[0],
) {
  return new WorkspaceCameraMotion().advance(input);
}

describe("workspace camera animation", () => {
  it("settles in nearly the same wall time at 60 and 120 hertz", () => {
    const at60 = settleDuration(1000 / 60);
    const at120 = settleDuration(1000 / 120);

    expect(at60).toBeGreaterThanOrEqual(350);
    expect(at60).toBeLessThanOrEqual(450);
    expect(Math.abs(at60 - at120)).toBeLessThanOrEqual(20);
  });

  it("catches up to elapsed time after a slow frame", () => {
    const frame = workspaceCameraAnimationFrame({
      deltaMs: 50,
      horizontalAnchorOffset: 0,
      overviewProgress: 0,
      scrollColumn: 0,
      scrollRow: 0,
      targetHorizontalAnchorOffset: 0,
      targetOverviewProgress: 0,
      targetScrollColumn: 1,
      targetScrollRow: 0,
      targetVerticalAnchorOffset: 0,
      verticalAnchorOffset: 0,
    });

    expect(frame.scrollColumn).toBeGreaterThan(0.5);
    expect(frame.state).toBe("moving");
  });

  it("keeps logical vertical motion active through subpixel settlement", () => {
    const duration = settleVerticalDuration(1000 / 60);

    expect(duration).toBeGreaterThanOrEqual(700);
    expect(duration).toBeLessThanOrEqual(850);
  });
});

function settleDuration(deltaMs: number): number {
  let elapsedMs = 0;
  let scrollColumn = 0;
  for (let frameIndex = 0; frameIndex < 200; frameIndex += 1) {
    const frame = workspaceCameraAnimationFrame({
      deltaMs,
      horizontalAnchorOffset: 0,
      overviewProgress: 0,
      scrollColumn,
      scrollRow: 0,
      targetHorizontalAnchorOffset: 0,
      targetOverviewProgress: 0,
      targetScrollColumn: 1,
      targetScrollRow: 0,
      targetVerticalAnchorOffset: 0,
      verticalAnchorOffset: 0,
    });
    elapsedMs += deltaMs;
    scrollColumn = frame.scrollColumn;
    if (frame.state === "idle") {
      return elapsedMs;
    }
  }
  throw new Error("camera animation did not settle");
}

function settleVerticalDuration(deltaMs: number): number {
  let elapsedMs = 0;
  let scrollRow = 0;
  for (let frameIndex = 0; frameIndex < 200; frameIndex += 1) {
    const frame = workspaceCameraAnimationFrame({
      deltaMs,
      horizontalAnchorOffset: 0,
      overviewProgress: 0,
      scrollColumn: 0,
      scrollRow,
      targetHorizontalAnchorOffset: 0,
      targetOverviewProgress: 0,
      targetScrollColumn: 0,
      targetScrollRow: 1,
      targetVerticalAnchorOffset: 0,
      verticalAnchorOffset: 0,
    });
    elapsedMs += deltaMs;
    scrollRow = frame.scrollRow;
    if (frame.state === "idle") {
      return elapsedMs;
    }
  }
  throw new Error("vertical camera animation did not settle");
}

describe("custom camera curves", () => {
  it("moves navigation along a fixed-duration curve with the supplied easing", () => {
    const motion = new WorkspaceCameraMotion();
    motion.configure(
      resolveCameraMotion({
        navigation: { durationMs: 200, easing: (progress) => progress },
      }),
    );
    const input = { ...settled, targetScrollColumn: 4 };

    const halfway = motion.advance({ ...input, deltaMs: 100 });
    expect(halfway).toMatchObject({ scrollColumn: 2, state: "moving" });
    const end = motion.advance({ ...input, deltaMs: 100, scrollColumn: 2 });
    expect(end).toMatchObject({ scrollColumn: 4, state: "moving" });
    expect(
      motion.advance({ ...input, deltaMs: 16, scrollColumn: 4 }).state,
    ).toBe("idle");
  });

  it("restarts a fixed-duration move from the current position when the target changes", () => {
    const motion = new WorkspaceCameraMotion();
    motion.configure(
      resolveCameraMotion({
        navigation: { durationMs: 100, easing: (progress) => progress },
      }),
    );
    motion.advance({ ...settled, deltaMs: 50, targetScrollColumn: 2 });

    const retargeted = motion.advance({
      ...settled,
      deltaMs: 50,
      scrollColumn: 1,
      targetScrollColumn: -1,
    });
    expect(retargeted.scrollColumn).toBe(0);
  });

  it("animates the overview zoom with its own curve", () => {
    const motion = new WorkspaceCameraMotion();
    motion.configure(
      resolveCameraMotion({
        zoom: { durationMs: 300, easing: (progress) => progress * progress },
      }),
    );
    const frame = motion.advance({
      ...settled,
      deltaMs: 150,
      targetOverviewProgress: 1,
    });

    expect(frame.overviewProgress).toBe(0.25);
    expect(frame.snapOverviewProgress).toBe(false);
  });

  it("keeps the exponential follow camera as the default", () => {
    expect(resolveCameraMotion(undefined)).toEqual(defaultCameraMotion);
    expect(
      resolveCameraMotion({ navigation: { durationMs: Number.NaN } })
        .navigation,
    ).toBe(defaultCameraMotion.navigation);
  });
});
