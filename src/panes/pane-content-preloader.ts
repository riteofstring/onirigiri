import type { PaneContentReadiness } from "./pane-content-readiness";
import type { PaneRenderItem } from "../types";

interface PanePreloadCandidate {
  item: PaneRenderItem;
  content: HTMLElement;
  readiness: PaneContentReadiness;
  mounted: () => boolean;
  current: () => boolean;
}

interface PendingPreload extends PanePreloadCandidate {
  deadline: number;
  abort: AbortController;
  capturing: boolean;
  monitor: number;
  previous: number;
  frameBudget: number;
  stalled: boolean;
}

interface QueuedPreload {
  candidate: PanePreloadCandidate;
  frame: number;
  previous: number | null;
  healthyFrames: number;
  interval: number;
}

export class PaneContentPreloader {
  private pending: PendingPreload | null = null;
  private queued: QueuedPreload | null = null;
  private frame: number | null = null;
  private readonly attempted = new Set<string>();
  private nextAdmission = 0;
  private recoveryDelay = 0;
  private lastHealthyFrame: number | null = null;

  constructor(
    private readonly changed: (paneId: string) => void,
    private readonly allowed: () => boolean,
    private readonly resting: () => boolean,
    private readonly capture: (
      paneId: string,
      signal: AbortSignal,
    ) => Promise<boolean>,
    private readonly captureReady: () => boolean,
  ) {}

  get paneId(): string | null {
    return this.pending?.item.paneId ?? null;
  }

  activity(): void {
    this.attempted.clear();
    this.cancel();
    this.cancelQueued();
    this.lastHealthyFrame = null;
  }

  navigation(): void {
    this.attempted.clear();
    if (!this.allowed()) this.activity();
  }

  forget(paneId: string): void {
    this.attempted.delete(paneId);
    if (this.paneId === paneId) this.cancel();
    if (this.queued?.candidate.item.paneId === paneId) this.cancelQueued();
  }

  advance(candidates: readonly PanePreloadCandidate[]): void {
    this.reconcile(candidates);
    if (!this.pending) this.select(candidates);
    this.paintPending();
  }

  private reconcile(candidates: readonly PanePreloadCandidate[]): void {
    if (this.pending && !this.pendingValid(candidates)) this.cancel();
    if (
      this.queued &&
      candidates.find((candidate) => this.needsPreload(candidate))?.item
        .paneId !== this.queued.candidate.item.paneId
    )
      this.cancelQueued();
  }

  private pendingValid(candidates: readonly PanePreloadCandidate[]): boolean {
    const pending = this.pending!;
    return (
      Date.now() < pending.deadline &&
      pending.current() &&
      candidates.some(
        (candidate) => candidate.item.paneId === pending.item.paneId,
      )
    );
  }

  private select(candidates: readonly PanePreloadCandidate[]): void {
    const candidate = candidates.find((candidate) =>
      this.needsPreload(candidate),
    );
    if (!candidate) return;
    if (this.queued) return;
    const view = candidate.content.ownerDocument.defaultView;
    if (!view) return;
    const queued = {
      candidate,
      frame: 0,
      previous: this.lastHealthyFrame,
      healthyFrames: this.lastHealthyFrame === null ? 0 : 1,
      interval: 40,
    };
    this.lastHealthyFrame = null;
    this.queued = queued;
    queued.frame = view.requestAnimationFrame((timestamp) =>
      this.checkHeadroom(queued, timestamp),
    );
  }

  private checkHeadroom(queued: QueuedPreload, timestamp: number): void {
    if (this.queued !== queued) return;
    if (!this.allowed() || !queued.candidate.current()) {
      this.cancelQueued();
      return;
    }
    this.recordFrame(queued, timestamp);
    if (queued.healthyFrames >= 2 && Date.now() >= this.nextAdmission) {
      this.queued = null;
      this.begin(queued, timestamp);
      return;
    }
    const view = queued.candidate.content.ownerDocument.defaultView!;
    queued.frame = view.requestAnimationFrame((next) =>
      this.checkHeadroom(queued, next),
    );
  }

  private recordFrame(queued: QueuedPreload, timestamp: number): void {
    const view = queued.candidate.content.ownerDocument.defaultView!;
    const healthy =
      queued.previous !== null &&
      timestamp > queued.previous &&
      timestamp - queued.previous <= (this.resting() ? 40 : 20) &&
      view.performance.now() - timestamp <= 8;
    queued.healthyFrames = healthy ? queued.healthyFrames + 1 : 0;
    if (healthy)
      queued.interval = Math.min(queued.interval, timestamp - queued.previous!);
    queued.previous = timestamp;
  }

  private begin(queued: QueuedPreload, timestamp: number): void {
    const candidate = queued.candidate;
    if (!candidate.current()) return;
    const pending = {
      ...candidate,
      deadline: Date.now() + 10000,
      abort: new AbortController(),
      capturing: false,
      monitor: 0,
      previous: timestamp,
      frameBudget: Math.max(20, queued.interval * 1.25),
      stalled: false,
    };
    this.pending = pending;
    this.attempted.add(candidate.item.paneId);
    this.monitor(pending);
    this.changed(candidate.item.paneId);
  }

  private monitor(pending: PendingPreload): void {
    const view = pending.content.ownerDocument.defaultView!;
    pending.monitor = view.requestAnimationFrame((timestamp) => {
      if (this.pending !== pending) return;
      pending.stalled ||=
        timestamp - pending.previous > pending.frameBudget ||
        view.performance.now() - timestamp > 8;
      pending.previous = timestamp;
      this.monitor(pending);
    });
  }

  private paintPending(): void {
    const pending = this.pending;
    if (
      !pending ||
      pending.capturing ||
      this.frame !== null ||
      !pending.mounted() ||
      !pending.readiness.getSnapshot()
    )
      return;
    const view = pending.content.ownerDocument.defaultView;
    if (!view) return;
    const key = preloadKey(pending);
    this.frame = view.requestAnimationFrame(() => {
      this.frame = view.requestAnimationFrame(
        () => void this.finish(pending, key),
      );
    });
  }

  private needsPreload(candidate: PanePreloadCandidate): boolean {
    return !this.attempted.has(candidate.item.paneId);
  }

  private async finish(pending: PendingPreload, key: string): Promise<void> {
    this.frame = null;
    if (this.pending !== pending || !this.readyForCapture(pending, key)) return;
    pending.capturing = true;
    await this.capture(pending.item.paneId, pending.abort.signal);
    if (this.pending !== pending) return;
    if (preloadKey(pending) === key) this.cancel();
    else {
      pending.capturing = false;
      this.paintPending();
    }
  }

  private readyForCapture(pending: PendingPreload, key: string): boolean {
    return (
      this.allowed() &&
      this.captureReady() &&
      pending.current() &&
      pending.content.isConnected &&
      pending.readiness.getSnapshot() &&
      preloadKey(pending) === key
    );
  }

  private cancelQueued(): void {
    const queued = this.queued;
    if (!queued) return;
    queued.candidate.content.ownerDocument.defaultView?.cancelAnimationFrame(
      queued.frame,
    );
    this.queued = null;
  }

  private cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    pending.abort.abort();
    if (this.frame !== null)
      pending.content.ownerDocument.defaultView?.cancelAnimationFrame(
        this.frame,
      );
    this.frame = null;
    this.pending = null;
    const view = pending.content.ownerDocument.defaultView!;
    view.cancelAnimationFrame(pending.monitor);
    pending.stalled ||=
      view.performance.now() - pending.previous > pending.frameBudget;
    this.lastHealthyFrame = pending.stalled ? null : pending.previous;
    this.recoveryDelay = pending.stalled
      ? Math.min(2000, Math.max(250, this.recoveryDelay * 2))
      : Math.floor(this.recoveryDelay / 2);
    this.nextAdmission = Date.now() + this.recoveryDelay;
    this.changed(pending.item.paneId);
  }
}

function preloadKey(candidate: PanePreloadCandidate): string {
  return `${candidate.readiness.revision}:${candidate.item.width}:${candidate.item.height}`;
}

export function adjacentPreloadDistance(
  bounds: DOMRect,
  viewport: DOMRect,
  margin: number,
): number | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  if (intersectsViewport(bounds, viewport)) return -1;
  const x = Math.max(
    viewport.left - bounds.right,
    bounds.left - viewport.right,
    0,
  );
  const y = Math.max(
    viewport.top - bounds.bottom,
    bounds.top - viewport.bottom,
    0,
  );
  return x <= bounds.width * margin && y <= bounds.height * margin
    ? x * x + y * y
    : null;
}

function intersectsViewport(bounds: DOMRect, viewport: DOMRect): boolean {
  return (
    bounds.right > viewport.left &&
    bounds.left < viewport.right &&
    bounds.bottom > viewport.top &&
    bounds.top < viewport.bottom
  );
}
