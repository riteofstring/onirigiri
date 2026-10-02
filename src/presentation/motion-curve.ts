import type {
  OnirigiriCameraMotion,
  OnirigiriEasing,
  OnirigiriFocusHighlightMotion,
  OnirigiriMotionCurve,
} from "../types.js";

export interface ResolvedCameraMotion {
  navigation: OnirigiriMotionCurve;
  overview: OnirigiriMotionCurve;
  zoom: OnirigiriMotionCurve;
}

interface MotionCurveSample {
  done: boolean;
  progress: number;
}

const exponentialSettleRemaining = 0.001;
const maximumExponentialStepMs = 50;

export const onirigiriEaseOutQuad: OnirigiriEasing = (progress) =>
  1 - (1 - progress) * (1 - progress);

export const defaultCameraMotion: ResolvedCameraMotion = Object.freeze({
  navigation: Object.freeze({ timeConstantMs: 55 }),
  overview: Object.freeze({ durationMs: 115, easing: onirigiriEaseOutQuad }),
  zoom: Object.freeze({ timeConstantMs: 55 }),
});

export const defaultFocusHighlightMotion: OnirigiriFocusHighlightMotion =
  "camera";

export function resolveCameraMotion(
  motion: OnirigiriCameraMotion | undefined,
): ResolvedCameraMotion {
  return {
    navigation: validMotionCurve(
      motion?.navigation,
      defaultCameraMotion.navigation,
    ),
    overview: validMotionCurve(motion?.overview, defaultCameraMotion.overview),
    zoom: validMotionCurve(motion?.zoom, defaultCameraMotion.zoom),
  };
}

export function validMotionCurve(
  curve: OnirigiriMotionCurve | undefined,
  fallback: OnirigiriMotionCurve,
): OnirigiriMotionCurve {
  if (!curve) {
    return fallback;
  }
  if ("timeConstantMs" in curve) {
    return Number.isFinite(curve.timeConstantMs) && curve.timeConstantMs > 0
      ? curve
      : fallback;
  }
  return Number.isFinite(curve.durationMs) && curve.durationMs >= 0
    ? curve
    : fallback;
}

export function motionCurveIsExponential(
  curve: OnirigiriMotionCurve,
): curve is { timeConstantMs: number } {
  return "timeConstantMs" in curve;
}

export function exponentialMotionBlend(
  timeConstantMs: number,
  deltaMs: number,
): number {
  const step = Math.min(maximumExponentialStepMs, Math.max(0, deltaMs));
  return 1 - Math.exp(-step / timeConstantMs);
}

export class MotionTimeline {
  private elapsedMs = 0;

  constructor(private curve: OnirigiriMotionCurve) {}

  restart(curve: OnirigiriMotionCurve = this.curve): void {
    this.curve = curve;
    this.elapsedMs = 0;
  }

  setCurve(curve: OnirigiriMotionCurve): void {
    this.curve = curve;
  }

  advance(deltaMs: number): MotionCurveSample {
    const step = Math.max(0, deltaMs);
    this.elapsedMs += motionCurveIsExponential(this.curve)
      ? Math.min(maximumExponentialStepMs, step)
      : step;
    return this.sample();
  }

  finish(): void {
    this.elapsedMs = Number.POSITIVE_INFINITY;
  }

  sample(): MotionCurveSample {
    return sampleMotionCurve(this.curve, this.elapsedMs);
  }
}

function sampleMotionCurve(
  curve: OnirigiriMotionCurve,
  elapsedMs: number,
): MotionCurveSample {
  if (motionCurveIsExponential(curve)) {
    const remaining = Math.exp(-elapsedMs / curve.timeConstantMs);
    return remaining <= exponentialSettleRemaining
      ? { done: true, progress: 1 }
      : { done: false, progress: 1 - remaining };
  }
  if (curve.durationMs <= 0 || elapsedMs >= curve.durationMs) {
    return { done: true, progress: 1 };
  }
  const easing = curve.easing ?? onirigiriEaseOutQuad;
  return { done: false, progress: easing(elapsedMs / curve.durationMs) };
}
