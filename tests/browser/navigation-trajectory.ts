export interface TrajectoryPaneBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface TrajectoryPaneSample extends TrajectoryPaneBox {
  moving: boolean;
  runtimeState: string | null;
  visible: boolean;
}

export interface TrajectoryFrame {
  focusedPaneId: string | null;
  moving: boolean;
  overviewProgress: string | null;
  panes: Record<string, TrajectoryPaneSample | null>;
  presentationMode: string | null;
  sampledAtMs: number;
  timeMs: number;
}

export interface TrajectoryMark {
  label: string;
  timeMs: number;
  travelOriginX?: number;
}

export interface TrajectoryCapture {
  frames: TrajectoryFrame[];
  marks: TrajectoryMark[];
}

export interface TrajectoryProbe {
  capture: TrajectoryCapture;
  running: boolean;
}

declare global {
  interface Window {
    __onirigiriTrajectoryProbe?: TrajectoryProbe;
  }
}

export interface RequestWindow {
  frames: TrajectoryFrame[];
  label: string;
  previous: TrajectoryFrame | null;
}

export type TrajectoryAxis = keyof TrajectoryPaneBox;

export interface AxisSeries {
  times: number[];
  values: number[];
}

export interface MotionAnalysis {
  directionChanges: number;
  distinctIntermediatePositions: number;
  firstStepFraction: number;
  firstStepGrowth: number;
  largestVelocityGrowth: number;
  midFlightStalls: number;
  movedAwayPx: number;
  travelPx: number;
}

export interface MovementAnalysis {
  movementStarts: number;
  movingAtEnd: boolean;
  movingBefore: boolean;
  movingFrames: number;
}

export interface RestingTail {
  movingFrames: number;
  stationary: boolean;
}

export interface DeferredActionReceipt<Result> {
  complete(): Promise<Result>;
}

type DeferredActionOutcome<Result> =
  { result: Result; succeeded: true } | { error: unknown; succeeded: false };

export async function waitForEvidenceBeforeActionCompletion<Result>(
  evidence: Promise<unknown>,
  action: Promise<Result>,
): Promise<DeferredActionReceipt<Result>> {
  const outcome = action.then<
    DeferredActionOutcome<Result>,
    DeferredActionOutcome<Result>
  >(
    (result) => ({ result, succeeded: true }),
    (error: unknown) => ({ error, succeeded: false }),
  );
  await evidence;
  return {
    complete: async () => {
      const completed = await outcome;
      if (!completed.succeeded) {
        throw completed.error;
      }
      return completed.result;
    },
  };
}

const movingStepPx = 1;
const nominalFrameMs = 1000 / 60;
const settleSnapFraction = 0.002;
const stallStepPx = 0.05;

export function installTrajectorySampler(paneIds: readonly string[]): void {
  const probe: TrajectoryProbe = {
    capture: { frames: [], marks: [] },
    running: true,
  };
  window.__onirigiriTrajectoryProbe = probe;
  const round = (value: number) => Number(value.toFixed(2));
  const paneSample = (paneId: string): TrajectoryPaneSample | null => {
    const element = document.querySelector<HTMLElement>(
      `.onirigiri-pane[data-onirigiri-pane-id="${paneId}"]`,
    );
    if (!element) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return {
      height: round(rect.height),
      moving: element.dataset.moving === "true",
      runtimeState: element.dataset.runtimeState ?? null,
      visible: element.dataset.visible === "true",
      width: round(rect.width),
      x: round(rect.x),
      y: round(rect.y),
    };
  };
  const workspaceState = () => {
    const workspace = document.querySelector<HTMLElement>(
      ".onirigiri-workspace",
    );
    const focused = workspace?.querySelector<HTMLElement>(
      '.onirigiri-pane[data-focused="true"]',
    );
    return {
      focusedPaneId: focused?.dataset.onirigiriPaneId ?? null,
      moving:
        workspace?.querySelector('.onirigiri-pane[data-moving="true"]') != null,
      overviewProgress: workspace?.dataset.overviewProgress ?? null,
      presentationMode: workspace?.dataset.presentationMode ?? null,
    };
  };
  const presentation = () => {
    const state = workspaceState();
    return {
      focusedPaneId: state.focusedPaneId,
      moving: state.moving,
      overviewProgress: state.overviewProgress,
      panes: Object.fromEntries(paneIds.map((id) => [id, paneSample(id)])),
      presentationMode: state.presentationMode,
    };
  };
  const beacon = document.createElement("div");
  beacon.setAttribute("aria-hidden", "true");
  beacon.style.cssText =
    "position:fixed;left:-16px;top:-16px;width:1px;height:1px;pointer-events:none;contain:strict;";
  document.body.append(beacon);
  let pendingTimeMs: number | null = null;
  let beaconWidth = 1;
  const observer = new ResizeObserver(() => {
    if (!probe.running || pendingTimeMs === null) {
      return;
    }
    const timeMs = pendingTimeMs;
    pendingTimeMs = null;
    probe.capture.frames.push({
      ...presentation(),
      sampledAtMs: performance.now(),
      timeMs,
    });
  });
  observer.observe(beacon);
  const tick = (timeMs: number) => {
    if (!probe.running) {
      observer.disconnect();
      beacon.remove();
      return;
    }
    pendingTimeMs = timeMs;
    beaconWidth = beaconWidth === 1 ? 2 : 1;
    beacon.style.width = `${beaconWidth}px`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export interface TrustedInputMark {
  eventType: "click" | "keydown";
  key?: string;
  label: string;
  travelOriginPaneId?: string;
}

export function markTrustedInputSequence(
  requests: readonly TrustedInputMark[],
): void {
  const probe = window.__onirigiriTrajectoryProbe;
  if (!probe) {
    throw new Error("The trajectory sampler is not installed.");
  }
  let requestIndex = 0;
  const eventTypes = [...new Set(requests.map((request) => request.eventType))];
  const stopListening = () => {
    for (const eventType of eventTypes) {
      window.removeEventListener(eventType, listener, { capture: true });
    }
  };
  const eventMatchesRequest = (
    event: Event,
    request: TrustedInputMark,
  ): boolean => {
    if (event.type !== request.eventType) {
      return false;
    }
    return (
      request.key === undefined || (event as KeyboardEvent).key === request.key
    );
  };
  const travelOriginPaneFor = (
    request: TrustedInputMark,
  ): HTMLElement | undefined => {
    if (request.travelOriginPaneId === undefined) {
      return undefined;
    }
    const pane = Array.from(
      document.querySelectorAll<HTMLElement>(".onirigiri-pane"),
    ).find(
      (element) =>
        element.dataset.onirigiriPaneId === request.travelOriginPaneId,
    );
    if (!pane) {
      throw new Error(
        `The trajectory origin pane ${request.travelOriginPaneId} is unavailable.`,
      );
    }
    return pane;
  };
  const listener = (event: Event) => {
    const request = requests[requestIndex];
    if (!request || !eventMatchesRequest(event, request)) {
      return;
    }
    const travelOriginPane = travelOriginPaneFor(request);
    probe.capture.marks.push({
      label: request.label,
      timeMs: performance.now(),
      ...(travelOriginPane === undefined
        ? {}
        : { travelOriginX: travelOriginPane.getBoundingClientRect().x }),
    });
    requestIndex += 1;
    if (requestIndex === requests.length) {
      stopListening();
    }
  };
  for (const eventType of eventTypes) {
    window.addEventListener(eventType, listener, { capture: true });
  }
}

export function stopTrajectorySampler(): TrajectoryCapture {
  const probe = window.__onirigiriTrajectoryProbe;
  if (!probe) {
    throw new Error("The trajectory sampler is not installed.");
  }
  probe.running = false;
  return probe.capture;
}

export function requestWindows(capture: TrajectoryCapture): RequestWindow[] {
  const marks = [...capture.marks].sort(
    (left, right) => left.timeMs - right.timeMs,
  );
  return marks.map((mark, index) => {
    const end = marks[index + 1]?.timeMs ?? Number.POSITIVE_INFINITY;
    const before = capture.frames.filter(
      (frame) => frame.sampledAtMs < mark.timeMs,
    );
    return {
      frames: capture.frames.filter(
        (frame) => frame.sampledAtMs >= mark.timeMs && frame.sampledAtMs < end,
      ),
      label: mark.label,
      previous: before.at(-1) ?? null,
    };
  });
}

export function axisSeries(
  window: RequestWindow,
  paneId: string,
  axis: TrajectoryAxis,
): AxisSeries {
  const frames = window.previous
    ? [window.previous, ...window.frames]
    : window.frames;
  const times: number[] = [];
  const values: number[] = [];
  for (const frame of frames) {
    const box = frame.panes[paneId];
    if (box?.visible) {
      times.push(frame.timeMs);
      values.push(box[axis]);
    }
  }
  return { times, values };
}

export function analyzeMotion(series: AxisSeries): MotionAnalysis {
  const { values } = series;
  const steps = motionSteps(series);
  const travelPx = Math.abs((values.at(-1) ?? 0) - (values[0] ?? 0));
  const range = movingRange(
    steps,
    Math.max(movingStepPx, settleSnapFraction * travelPx),
  );
  const firstStep = steps[range.first];
  const firstStepPx = normalizedFrameStepPx(firstStep);
  const secondSpeed = speedOf(steps[range.first + 1]);
  return {
    directionChanges: directionChangeCount(steps),
    distinctIntermediatePositions: distinctIntermediatePositions(values),
    firstStepFraction: travelPx > 0 ? firstStepPx / travelPx : 0,
    firstStepGrowth: secondSpeed > 0 ? speedOf(firstStep) / secondSpeed : 0,
    largestVelocityGrowth: largestVelocityGrowth(steps, range),
    midFlightStalls: midFlightStallCount(steps, range),
    movedAwayPx: movedAwayPx(values),
    travelPx,
  };
}

export function analyzeMovement(window: RequestWindow): MovementAnalysis {
  const movingBefore = window.previous?.moving ?? false;
  let previousMoving = movingBefore;
  let movementStarts = 0;
  let movingFrames = 0;
  for (const frame of window.frames) {
    if (frame.moving) {
      movingFrames += 1;
      if (!previousMoving) {
        movementStarts += 1;
      }
    }
    previousMoving = frame.moving;
  }
  return {
    movementStarts,
    movingAtEnd: window.frames.at(-1)?.moving ?? false,
    movingBefore,
    movingFrames,
  };
}

export function restingTail(
  window: RequestWindow,
  paneId: string,
  frameCount = 3,
): RestingTail {
  const tail = window.frames.slice(-frameCount);
  const positions = tail
    .map((frame) => frame.panes[paneId])
    .filter((box): box is TrajectoryPaneSample => box?.visible === true)
    .map(
      (box) =>
        `${box.x.toFixed(1)},${box.y.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)}`,
    );
  return {
    movingFrames: tail.filter((frame) => frame.moving).length,
    stationary:
      positions.length === frameCount && new Set(positions).size === 1,
  };
}

export function describeMovement(window: RequestWindow, limit = 72): string {
  const frames = window.previous
    ? [window.previous, ...window.frames]
    : window.frames;
  const shown = frames
    .slice(0, limit)
    .map((frame) => `${frame.timeMs.toFixed(1)}:${frame.moving ? "M" : "-"}`);
  const tail = frames.length > limit ? ` … (${frames.length} frames)` : "";
  return `${shown.join(" ")}${tail}`;
}

export function describeSeries(series: AxisSeries, limit = 72): string {
  const shown = series.values.slice(0, limit).map((value) => value.toFixed(1));
  const tail =
    series.values.length > limit
      ? ` … ${series.values.at(-1)?.toFixed(1)}`
      : "";
  return `${shown.join(" ")}${tail} (${series.values.length} samples)`;
}

interface MotionStep {
  deltaMs: number;
  deltaPx: number;
}

interface MovingRange {
  first: number;
  last: number;
}

function motionSteps({ times, values }: AxisSeries): MotionStep[] {
  return values.slice(1).map((value, index) => ({
    deltaMs: Math.max(0, (times[index + 1] ?? 0) - (times[index] ?? 0)),
    deltaPx: value - (values[index] ?? value),
  }));
}

function movingRange(
  steps: readonly MotionStep[],
  thresholdPx: number,
): MovingRange {
  const isMoving = (step: MotionStep) => Math.abs(step.deltaPx) > thresholdPx;
  const first = steps.findIndex(isMoving);
  const last = steps.length - 1 - [...steps].reverse().findIndex(isMoving);
  return first < 0 ? { first: -1, last: -1 } : { first, last };
}

function speedOf(step: MotionStep | undefined): number {
  return step && step.deltaMs > 0 ? Math.abs(step.deltaPx) / step.deltaMs : 0;
}

function normalizedFrameStepPx(step: MotionStep | undefined): number {
  if (!step || step.deltaMs <= 0) {
    return 0;
  }
  return Math.abs(step.deltaPx) * Math.min(1, nominalFrameMs / step.deltaMs);
}

function stepSign(step: MotionStep): number {
  return Math.abs(step.deltaPx) < stallStepPx ? 0 : Math.sign(step.deltaPx);
}

function directionChangeCount(steps: readonly MotionStep[]): number {
  let changes = 0;
  let previousSign = 0;
  for (const step of steps) {
    const sign = stepSign(step);
    if (sign !== 0 && previousSign !== 0 && sign !== previousSign) {
      changes += 1;
    }
    previousSign = sign === 0 ? previousSign : sign;
  }
  return changes;
}

function midFlightStallCount(
  steps: readonly MotionStep[],
  range: MovingRange,
): number {
  return steps.filter(
    (step, index) =>
      index > range.first && index < range.last && stepSign(step) === 0,
  ).length;
}

function largestVelocityGrowth(
  steps: readonly MotionStep[],
  range: MovingRange,
): number {
  let largest = 0;
  for (let index = range.first + 2; index <= range.last; index += 1) {
    const previousSpeed = speedOf(steps[index - 1]);
    if (previousSpeed > 0) {
      largest = Math.max(largest, speedOf(steps[index]) / previousSpeed);
    }
  }
  return largest;
}

function movedAwayPx(values: readonly number[]): number {
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? first;
  const startDistance = Math.abs(last - first);
  return Math.max(
    0,
    ...values.map((value) => Math.abs(value - last) - startDistance),
  );
}

function distinctIntermediatePositions(values: readonly number[]): number {
  const distinct = new Set(values.map((value) => value.toFixed(1)));
  distinct.delete((values[0] ?? 0).toFixed(1));
  distinct.delete((values.at(-1) ?? 0).toFixed(1));
  return distinct.size;
}
