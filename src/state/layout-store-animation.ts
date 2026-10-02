import {
  defaultCameraMotion,
  exponentialMotionBlend,
  motionCurveIsExponential,
  MotionTimeline,
  type ResolvedCameraMotion,
} from "../presentation/motion-curve";

interface WorkspaceCameraAnimationInput {
  deltaMs: number;
  horizontalAnchorOffset: number;
  overviewProgress: number;
  scrollColumn: number;
  scrollRow: number;
  targetHorizontalAnchorOffset: number;
  targetOverviewProgress: number;
  targetScrollColumn: number;
  targetScrollRow: number;
  targetVerticalAnchorOffset: number;
  verticalAnchorOffset: number;
}

interface WorkspaceCameraAnimationFrame {
  horizontalAnchorOffset: number;
  overviewProgress: number;
  scrollColumn: number;
  scrollRow: number;
  snapOverviewProgress: boolean;
  state: "idle" | "moving";
  verticalAnchorOffset: number;
}

interface NavigationValues {
  horizontalAnchorOffset: number;
  scrollColumn: number;
  scrollRow: number;
  verticalAnchorOffset: number;
}

interface CameraTween<Value> {
  start: Value;
  target: Value;
  timeline: MotionTimeline;
}

interface NavigationStep {
  settled: boolean;
  values: NavigationValues;
}

interface ZoomStep {
  progress: number;
  settled: boolean;
  snap: boolean;
}

const settleThreshold = 0.001;
const scrollRowSettleThreshold = 0.000001;

export class WorkspaceCameraMotion {
  private motion: ResolvedCameraMotion = defaultCameraMotion;
  private navigationTween: CameraTween<NavigationValues> | null = null;
  private zoomTween: CameraTween<number> | null = null;

  configure(motion: ResolvedCameraMotion): void {
    this.motion = motion;
    if (motionCurveIsExponential(motion.navigation)) {
      this.navigationTween = null;
    } else {
      this.navigationTween?.timeline.setCurve(motion.navigation);
    }
    if (motionCurveIsExponential(motion.zoom)) {
      this.zoomTween = null;
    } else {
      this.zoomTween?.timeline.setCurve(motion.zoom);
    }
  }

  reset(): void {
    this.navigationTween = null;
    this.zoomTween = null;
  }

  advance(input: WorkspaceCameraAnimationInput): WorkspaceCameraAnimationFrame {
    const navigation = this.advanceNavigation(input);
    const zoom = this.advanceZoom(input);
    return {
      ...navigation.values,
      overviewProgress: zoom.progress,
      snapOverviewProgress: zoom.snap,
      state: navigation.settled && zoom.settled ? "idle" : "moving",
    };
  }

  private advanceNavigation(
    input: WorkspaceCameraAnimationInput,
  ): NavigationStep {
    const target = navigationTarget(input);
    if (navigationIsSettled(input)) {
      this.navigationTween = null;
      return { settled: true, values: target };
    }
    const curve = this.motion.navigation;
    if (motionCurveIsExponential(curve)) {
      return {
        settled: false,
        values: steppedNavigation(
          input,
          exponentialMotionBlend(curve.timeConstantMs, input.deltaMs),
        ),
      };
    }
    if (
      !this.navigationTween ||
      !sameNavigation(this.navigationTween.target, target)
    ) {
      this.navigationTween = {
        start: navigationCurrent(input),
        target,
        timeline: new MotionTimeline(curve),
      };
    }
    const tween = this.navigationTween;
    const sample = tween.timeline.advance(input.deltaMs);
    return {
      settled: false,
      values: sample.done
        ? target
        : interpolatedNavigation(tween, sample.progress),
    };
  }

  private advanceZoom(input: WorkspaceCameraAnimationInput): ZoomStep {
    const target = input.targetOverviewProgress;
    if (withinSettleThreshold(target - input.overviewProgress)) {
      this.zoomTween = null;
      return { progress: target, settled: true, snap: true };
    }
    const curve = this.motion.zoom;
    if (motionCurveIsExponential(curve)) {
      const progress =
        input.overviewProgress +
        (target - input.overviewProgress) *
          exponentialMotionBlend(curve.timeConstantMs, input.deltaMs);
      return {
        progress,
        settled: false,
        snap: withinSettleThreshold(target - progress),
      };
    }
    if (!this.zoomTween || this.zoomTween.target !== target) {
      this.zoomTween = {
        start: input.overviewProgress,
        target,
        timeline: new MotionTimeline(curve),
      };
    }
    const tween = this.zoomTween;
    const sample = tween.timeline.advance(input.deltaMs);
    return {
      progress: sample.done
        ? target
        : tween.start + (target - tween.start) * sample.progress,
      settled: false,
      snap: sample.done,
    };
  }
}

function navigationTarget(
  input: WorkspaceCameraAnimationInput,
): NavigationValues {
  return {
    horizontalAnchorOffset: input.targetHorizontalAnchorOffset,
    scrollColumn: input.targetScrollColumn,
    scrollRow: input.targetScrollRow,
    verticalAnchorOffset: input.targetVerticalAnchorOffset,
  };
}

function navigationCurrent(
  input: WorkspaceCameraAnimationInput,
): NavigationValues {
  return {
    horizontalAnchorOffset: input.horizontalAnchorOffset,
    scrollColumn: input.scrollColumn,
    scrollRow: input.scrollRow,
    verticalAnchorOffset: input.verticalAnchorOffset,
  };
}

function navigationIsSettled(input: WorkspaceCameraAnimationInput): boolean {
  return (
    withinSettleThreshold(
      input.targetHorizontalAnchorOffset - input.horizontalAnchorOffset,
    ) &&
    withinSettleThreshold(input.targetScrollColumn - input.scrollColumn) &&
    workspaceScrollRowIsSettled(input.scrollRow, input.targetScrollRow) &&
    withinSettleThreshold(
      input.targetVerticalAnchorOffset - input.verticalAnchorOffset,
    )
  );
}

function sameNavigation(
  left: NavigationValues,
  right: NavigationValues,
): boolean {
  return (
    left.horizontalAnchorOffset === right.horizontalAnchorOffset &&
    left.scrollColumn === right.scrollColumn &&
    left.scrollRow === right.scrollRow &&
    left.verticalAnchorOffset === right.verticalAnchorOffset
  );
}

function interpolatedNavigation(
  tween: CameraTween<NavigationValues>,
  progress: number,
): NavigationValues {
  const { start, target } = tween;
  return {
    horizontalAnchorOffset:
      start.horizontalAnchorOffset +
      (target.horizontalAnchorOffset - start.horizontalAnchorOffset) * progress,
    scrollColumn:
      start.scrollColumn +
      (target.scrollColumn - start.scrollColumn) * progress,
    scrollRow:
      start.scrollRow + (target.scrollRow - start.scrollRow) * progress,
    verticalAnchorOffset:
      start.verticalAnchorOffset +
      (target.verticalAnchorOffset - start.verticalAnchorOffset) * progress,
  };
}

function steppedNavigation(
  input: WorkspaceCameraAnimationInput,
  blend: number,
): NavigationValues {
  return {
    horizontalAnchorOffset: steppedValue(
      input.horizontalAnchorOffset,
      input.targetHorizontalAnchorOffset,
      blend,
    ),
    scrollColumn: steppedGridCoordinate(
      input.scrollColumn,
      input.targetScrollColumn,
      blend,
    ),
    scrollRow: steppedGridCoordinate(
      input.scrollRow,
      input.targetScrollRow,
      blend,
      scrollRowSettleThreshold,
    ),
    verticalAnchorOffset: steppedValue(
      input.verticalAnchorOffset,
      input.targetVerticalAnchorOffset,
      blend,
    ),
  };
}

function steppedValue(current: number, target: number, blend: number): number {
  const next = current + (target - current) * blend;
  return withinSettleThreshold(target - next) ? target : next;
}

function steppedGridCoordinate(
  current: number,
  target: number,
  blend: number,
  threshold = settleThreshold,
): number {
  const interpolated = current + (target - current) * blend;
  const next =
    Math.abs(target - interpolated) <= threshold ? target : interpolated;
  if (next !== current || current === target) {
    return next;
  }
  const direction = Math.sign(target - current);
  const advanced = current + direction;
  return direction > 0
    ? Math.min(advanced, target)
    : Math.max(advanced, target);
}

function withinSettleThreshold(distance: number): boolean {
  return Math.abs(distance) <= settleThreshold;
}

export function workspaceScrollRowIsSettled(
  scrollRow: number,
  targetScrollRow: number,
): boolean {
  return Math.abs(scrollRow - targetScrollRow) <= scrollRowSettleThreshold;
}
