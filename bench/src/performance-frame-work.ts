import type { PerformanceOnirigiriBoundarySample } from "./performance-types";

interface ActiveRequestWork {
  reactCommitCount: number;
  reactWorkDurationMs: number;
  startTimeMs: number;
}

interface PendingRequestWork {
  count: number;
  durationMs: number;
  frameSequence: number;
}

interface PerformanceWorkMeter {
  activeRequest: ActiveRequestWork | null;
  boundarySamples: PerformanceOnirigiriBoundarySample[];
  byFrame: Map<number, number>;
  frameSequence: number;
  lastFrameTimestamp: number | null;
  pendingRequest: PendingRequestWork | null;
  recording: boolean;
}

interface PerformanceWorkRecording {
  animationFrameWorkMs: number[];
  onirigiriBoundaries: PerformanceOnirigiriBoundarySample[];
}

let meter: PerformanceWorkMeter | null = null;

export function installAnimationFrameWorkMeter(): void {
  if (meter) {
    return;
  }
  const state: PerformanceWorkMeter = {
    activeRequest: null,
    boundarySamples: [],
    byFrame: new Map(),
    frameSequence: 0,
    lastFrameTimestamp: null,
    pendingRequest: null,
    recording: false,
  };
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    nativeRequestAnimationFrame((time) => {
      const recordingAtStart = state.recording;
      if (state.recording && state.lastFrameTimestamp !== time) {
        state.lastFrameTimestamp = time;
        state.frameSequence += 1;
      }
      const start = performance.now();
      try {
        callback(time);
      } finally {
        if (recordingAtStart) {
          const duration = performance.now() - start;
          state.byFrame.set(time, (state.byFrame.get(time) ?? 0) + duration);
        }
      }
    });
  meter = state;
}

export function startPerformanceWorkRecording(): void {
  const state = requiredMeter();
  if (state.recording) {
    throw new Error("Performance work recording is already active.");
  }
  state.activeRequest = null;
  state.boundarySamples.length = 0;
  state.byFrame.clear();
  state.frameSequence = 0;
  state.lastFrameTimestamp = null;
  state.pendingRequest = null;
  state.recording = true;
}

export function stopPerformanceWorkRecording(): PerformanceWorkRecording {
  const state = requiredMeter();
  if (!state.recording) {
    throw new Error("Performance work recording is not active.");
  }
  if (state.activeRequest) {
    throw new Error(
      "Cannot stop performance recording inside a Onirigiri request.",
    );
  }
  flushPendingRequest(state);
  state.recording = false;
  return {
    animationFrameWorkMs: [...state.byFrame.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, durationMs]) => durationMs),
    onirigiriBoundaries: [...state.boundarySamples],
  };
}

export function measureOnirigiriRequestWork<T>(request: () => T): T {
  const state = requiredMeter();
  if (!state.recording || state.activeRequest) {
    return request();
  }
  flushRequestFromPriorFrame(state);
  const activeRequest: ActiveRequestWork = {
    reactCommitCount: 0,
    reactWorkDurationMs: 0,
    startTimeMs: performance.now(),
  };
  state.activeRequest = activeRequest;
  try {
    return request();
  } finally {
    const requestWallDurationMs = Math.max(
      0,
      performance.now() - activeRequest.startTimeMs,
    );
    state.activeRequest = null;
    if (activeRequest.reactCommitCount > 0) {
      recordActiveRequestBoundary(
        state,
        requestWallDurationMs,
        activeRequest.reactCommitCount,
        activeRequest.reactWorkDurationMs,
      );
    } else {
      appendPendingRequest(state, requestWallDurationMs);
    }
  }
}

export function recordReactBoundaryWork(reactWorkDurationMs: number): void {
  const state = requiredMeter();
  if (!state.recording) {
    return;
  }
  const durationMs = Math.max(0, reactWorkDurationMs);
  if (state.activeRequest) {
    state.activeRequest.reactCommitCount += 1;
    state.activeRequest.reactWorkDurationMs += durationMs;
    return;
  }
  if (state.pendingRequest?.frameSequence === state.frameSequence) {
    const requestWorkDurationMs = state.pendingRequest.durationMs;
    const requestCount = state.pendingRequest.count;
    state.pendingRequest = null;
    state.boundarySamples.push({
      boundaryWorkDurationMs: requestWorkDurationMs + durationMs,
      reactCommitCount: 1,
      reactWorkDurationMs: durationMs,
      requestCount,
      requestHandlerWorkDurationMs: requestWorkDurationMs,
    });
    return;
  }
  flushPendingRequest(state);
  state.boundarySamples.push({
    boundaryWorkDurationMs: durationMs,
    reactCommitCount: 1,
    reactWorkDurationMs: durationMs,
    requestCount: 0,
    requestHandlerWorkDurationMs: 0,
  });
}

function recordActiveRequestBoundary(
  state: PerformanceWorkMeter,
  requestWallDurationMs: number,
  reactCommitCount: number,
  reactWorkDurationMs: number,
): void {
  const precedingRequestWorkDurationMs = state.pendingRequest?.durationMs ?? 0;
  const precedingRequestCount = state.pendingRequest?.count ?? 0;
  state.pendingRequest = null;
  const activeRequestHandlerWorkDurationMs = Math.max(
    0,
    requestWallDurationMs - reactWorkDurationMs,
  );
  const requestHandlerWorkDurationMs =
    precedingRequestWorkDurationMs + activeRequestHandlerWorkDurationMs;
  state.boundarySamples.push({
    boundaryWorkDurationMs: requestHandlerWorkDurationMs + reactWorkDurationMs,
    reactCommitCount,
    reactWorkDurationMs,
    requestCount: precedingRequestCount + 1,
    requestHandlerWorkDurationMs,
  });
}

function appendPendingRequest(
  state: PerformanceWorkMeter,
  durationMs: number,
): void {
  const pending = state.pendingRequest;
  if (pending?.frameSequence === state.frameSequence) {
    pending.count += 1;
    pending.durationMs += durationMs;
    return;
  }
  flushPendingRequest(state);
  state.pendingRequest = {
    count: 1,
    durationMs,
    frameSequence: state.frameSequence,
  };
}

function flushRequestFromPriorFrame(state: PerformanceWorkMeter): void {
  if (
    state.pendingRequest &&
    state.pendingRequest.frameSequence !== state.frameSequence
  ) {
    flushPendingRequest(state);
  }
}

function flushPendingRequest(state: PerformanceWorkMeter): void {
  const pending = state.pendingRequest;
  if (!pending) {
    return;
  }
  state.pendingRequest = null;
  state.boundarySamples.push({
    boundaryWorkDurationMs: pending.durationMs,
    reactCommitCount: 0,
    reactWorkDurationMs: 0,
    requestCount: pending.count,
    requestHandlerWorkDurationMs: pending.durationMs,
  });
}

function requiredMeter(): PerformanceWorkMeter {
  if (!meter) {
    throw new Error(
      "The performance work meter must be installed before the fixture mounts.",
    );
  }
  return meter;
}
