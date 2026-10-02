import {
  PanePresentationPolicy,
  type PaneLiveRenderer,
  type PanePresentationState,
  type PanePresentationPhase,
  type ResolvedPanePresentation,
} from "../presentation/pane-presentation-policy";
import {
  createPaneCanvasDevice,
  PaneCanvasSurface,
} from "./pane-picture-canvas";
import {
  resolveConfiguration,
  acquisitionChanged,
  samePictureSurface,
  type Configuration,
  type ResolvedConfiguration,
} from "./pane-picture-configuration";
import {
  PaneContentPreloader,
  adjacentPreloadDistance,
} from "../panes/pane-content-preloader";
import { PanePictureActivity } from "./pane-picture-activity";
import {
  PanePictureActivation,
  orderPaneActivation,
} from "./pane-picture-activation";
import type { PaneContentReadiness } from "../panes/pane-content-readiness";
import type { WorkspacePresentationBoundaryFrame } from "../presentation/workspace-frame-scheduler";
import { paneWorldBoxIntersectsRect } from "../presentation/workspace-sweep-geometry";
import type {
  OnirigiriCaptureStatus,
  OnirigiriPaneCaptureReceipt,
  OnirigiriPanePicture,
  OnirigiriPanePictureResolver,
} from "./pane-picture-types";
import { pngDimensions, validatePictureDecode } from "./pane-picture-raster";
import type { PaneId, PaneRenderItem, WorkspacePane } from "../types";
import { PanePictureCache, type CachedPanePicture } from "./pane-picture-cache";
import { preparePanePictureTexture } from "./pane-picture-texture";

interface ContentHost {
  content: HTMLElement;
  readiness: PaneContentReadiness;
  mounted: () => boolean;
  surface: PaneCanvasSurface;
  drawn: boolean;
  error: string | null;
  renderer: PaneLiveRenderer | null;
  cover: "texture" | "placeholder" | null;
}

interface Candidate extends ContentHost {
  paneId: PaneId;
  pane: WorkspacePane;
  revision: number;
  bounds: DOMRect;
  key: string;
}

interface Attempt {
  key: string;
  failures: number;
  retryAt: number;
}

interface Batch {
  id: string;
  devicePixelRatio: number;
  preload: boolean;
  overview: boolean;
  abort: AbortController;
  panes: Candidate[];
}

const maxEncodedBytes = 32 * 1024 * 1024;
const maxRasterBytes = 128 * 1024 * 1024;

export class PanePictures {
  private readonly pictures = new PanePictureCache(
    async (image, size, valid) => {
      const document = this.root!.ownerDocument;
      return preparePanePictureTexture(
        document,
        await this.getDevice(document),
        image,
        size,
        valid,
      );
    },
    (id) => this.emit(id),
  );
  private readonly hosts = new Map<PaneId, ContentHost>();
  private itemsById = new Map<PaneId, PaneRenderItem>();
  private readonly covers = new Map<PaneId, "texture" | "placeholder">();
  private readonly policy = new PanePresentationPolicy();
  private readonly presentations = new Map<PaneId, PanePresentationState>();
  private visibleIds = new Set<PaneId>();
  private frame: WorkspacePresentationBoundaryFrame | null = null;
  private motionActive = false;
  private readonly listeners = new Map<PaneId, Set<() => void>>();
  private readonly attempts = new Map<PaneId, Attempt>();
  private readonly captureExcluded = new Set<PaneId>();
  private readonly supplied = new Map<PaneId, WeakRef<Blob>>();
  private readonly deferredSupplied = new Map<PaneId, WeakRef<Blob>>();
  private configuration: ResolvedConfiguration = {
    panes: new Map(),
    items: [],
    budgetBytes: 256 * 1024 * 1024,
    rasterBudgetBytes: 256 * 1024 * 1024,
    minLongEdgePx: 128,
  };
  private root: HTMLElement | null = null;
  private viewportReady = true;
  private device: Promise<GPUDevice> | null = null;
  private deviceReady = false;
  private captureUnavailable: string | null = null;
  private readonly preloader = new PaneContentPreloader(
    (paneId) => {
      this.emit(paneId);
      this.publish();
      this.wake();
    },
    () => this.preloadAllowed() && !this.moving(),
    () => this.idle(),
    (paneId, signal) => this.capturePreload(paneId, signal),
    () => !this.busy,
  );
  isPreloading = (paneId: PaneId): boolean => this.preloader.paneId === paneId;
  private readonly activation = new PanePictureActivation((id) => {
    this.emit(id);
    this.hosts.get(id)?.surface.requestPaint();
    this.wake();
  });
  isLive = (paneId: PaneId): boolean => this.activation.has(paneId);
  isContinuous = (): boolean =>
    this.configuration.liveContent === true ||
    this.configuration.presentation !== undefined ||
    this.configuration.getPresentation !== undefined;
  isInteractive = (): boolean =>
    !this.moving() && !this.overview() && !this.interaction.resizing();
  private readonly interaction = new PanePictureActivity(
    (presentationChanged) => this.noteActivity(presentationChanged),
  );
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timerAt = Infinity;
  private focusedPaintFrame: number | null = null;
  private active: Batch | null = null;
  private busy = false;
  private epoch = 0;
  private overviewPane: { paneId: PaneId; deadline: number } | null = null;
  private readonly overviewAttempts = new Set<PaneId>();
  private accepted = 0;
  private rejected = 0;
  private invalidated = 0;
  private reason: string | null = null;
  private status: OnirigiriCaptureStatus = {
    state: "unconfigured",
    reason: null,
    pictureBytes: 0,
    pictureRasterBytes: 0,
    overviewPaneId: null,
    preloadingPaneId: null,
    pictures: [],
    inFlightPaneIds: [],
    accepted: 0,
    rejected: 0,
    invalidated: 0,
  };

  constructor(
    private readonly moving: () => boolean,
    private readonly focused: () => PaneId | null,
    private readonly overview: () => boolean = () => false,
  ) {}

  get = (paneId: PaneId): CachedPanePicture | null => this.pictures.get(paneId);
  getStatus = (): OnirigiriCaptureStatus => this.status;
  getPaneError = (paneId: PaneId): string | null =>
    this.hosts.get(paneId)?.error ?? null;
  isDrawn = (paneId: PaneId): boolean => this.hosts.get(paneId)?.drawn ?? false;
  isOverviewCapture = (paneId: PaneId): boolean =>
    this.overviewPane?.paneId === paneId;

  subscribe(paneId: PaneId, listener: () => void): () => void {
    const listeners = this.listeners.get(paneId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(paneId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(paneId);
    };
  }

  configure(input: Configuration): void {
    const configuration = resolveConfiguration(input);
    const wasContinuous = this.isContinuous();
    if (acquisitionChanged(configuration, this.configuration)) {
      this.preloader.activity();
      this.activity();
      this.reason = null;
    }
    if (
      (["budgetBytes", "rasterBudgetBytes"] as const).some(
        (key) => configuration[key] !== this.configuration[key],
      )
    )
      this.attempts.clear();
    this.reconcileIdentities(configuration.panes);
    this.configuration = { ...configuration };
    this.itemsById = new Map(
      configuration.items.map((item) => [item.paneId, item]),
    );
    this.policy.configure(
      configuration.presentation,
      configuration.getPresentation,
    );
    if (wasContinuous !== this.isContinuous()) {
      this.cancel();
      this.setOverviewPane(null);
      this.updateResizing();
    }
    if (this.overviewPane && !configuration.panes.has(this.overviewPane.paneId))
      this.setOverviewPane(null);
    this.pictures.configure(configuration, this.focused());
    this.refreshSurfaces();
    for (const id of this.hosts.keys()) this.emit(id);
    this.publish();
    this.wake();
  }

  private refreshSurfaces(): void {
    const preloading = this.preloader.paneId;
    if (
      preloading &&
      this.configuration.items.some(
        (item) =>
          item.paneId === preloading &&
          item.visible &&
          item.presentationMode === "normal",
      )
    )
      this.preloader.forget(preloading);
    this.updateActivation();
    for (const host of this.hosts.values()) {
      if (!host.mounted() && host.drawn && !this.interaction.resizing())
        host.surface.clear();
      else host.surface.requestPaint();
    }
    this.requestFocusedFrame();
  }

  private reconcileIdentities(panes: ReadonlyMap<PaneId, WorkspacePane>): void {
    for (const [id, pane] of this.configuration.panes) {
      const next = panes.get(id);
      if (!next || !samePictureSurface(pane, next)) {
        this.preloader.forget(id);
        this.pictures.release(id);
        this.supplied.delete(id);
        this.deferredSupplied.delete(id);
        this.overviewAttempts.delete(id);
        if (this.isOverviewCapture(id)) this.setOverviewPane(null);
        this.attempts.delete(id);
        this.captureExcluded.delete(id);
        this.policy.forget(id);
        this.pictures.setDetail(id, "full");
        this.presentations.delete(id);
        this.covers.delete(id);
      }
    }
  }

  start(root: HTMLElement): () => void {
    this.root = root;
    const viewport = root.ownerDocument.defaultView?.visualViewport;
    this.viewportReady = captureViewportReady(viewport);
    const viewportChanged = () => {
      const ready = captureViewportReady(viewport);
      if (ready === this.viewportReady) return;
      this.viewportReady = ready;
      this.activity();
    };
    viewport?.addEventListener("resize", viewportChanged);
    viewport?.addEventListener("scroll", viewportChanged);
    const stopActivity = this.interaction.start(root.ownerDocument);
    this.wake();
    return () => {
      viewport?.removeEventListener("resize", viewportChanged);
      viewport?.removeEventListener("scroll", viewportChanged);
      stopActivity();
      if (this.focusedPaintFrame !== null)
        root.ownerDocument.defaultView?.cancelAnimationFrame(
          this.focusedPaintFrame,
        );
      this.focusedPaintFrame = null;
      clearTimeout(this.timer);
      this.timer = undefined;
      this.timerAt = Infinity;
      this.root = null;
      this.preloader.activity();
      this.activation.dispose();
      this.cancel();
      for (const host of this.hosts.values()) host.surface.dispose();
      void this.device?.then((device) => device.destroy()).catch(() => {});
      this.device = null;
      this.deviceReady = false;
      this.activity();
      for (const id of this.pictures.keys()) this.pictures.release(id);
      this.supplied.clear();
      this.attempts.clear();
      this.captureExcluded.clear();
      this.publish();
    };
  }

  register(
    paneId: PaneId,
    content: HTMLElement,
    readiness: PaneContentReadiness,
    mounted: () => boolean = () => true,
  ): () => void {
    const canvas = content.parentElement as HTMLCanvasElement;
    const host: ContentHost = {
      content,
      readiness,
      mounted,
      drawn: false,
      error: null,
      renderer: null,
      cover: this.covers.get(paneId) ?? null,
      surface: new PaneCanvasSurface(
        canvas,
        content,
        this.getDevice(content.ownerDocument),
        {
          continuous: this.isContinuous,
          canDraw: () => this.canDraw(paneId, host),
          canPrime: () => this.canPrime(paneId, host),
          visible: () => !this.isContinuous() || this.paneVisible(paneId),
          renderer: () => {
            const decision = this.decision(paneId);
            return decision.kind === "canvas" ||
              this.frozenSurface(paneId, host, decision)
              ? "canvas"
              : "dom";
          },
          frozen: () => this.frozenSurface(paneId, host),
          videoFrames: () => this.decision(paneId).requested === "auto",
          interactive: this.isInteractive,
          changed: () => {
            this.updateActivation();
            this.emit(paneId);
            this.wake();
          },
          hideScrollbars: () => !this.isInteractive(),
          displayScale: () => this.displayScale(paneId, host),
          revision: () => readiness.revision,
          drawn: (drawn, renderer) => {
            const nextRenderer = renderedContent(host, drawn, renderer);
            const rendererChanged = host.renderer !== nextRenderer;
            host.renderer = nextRenderer;
            if (drawn) this.activation.painted(paneId);
            const recovered = drawn && host.error !== null;
            if (drawn) host.error = null;
            if (
              (host.drawn === drawn && !recovered && !rendererChanged) ||
              this.hosts.get(paneId) !== host
            )
              return;
            host.drawn = drawn;
            this.emit(paneId);
          },
          failed: (error) => {
            if (this.hosts.get(paneId) !== host) return;
            host.drawn = false;
            host.error = error.message;
            this.reason = error.message;
            this.emit(paneId);
            this.publish();
          },
        },
      ),
    };
    this.hosts.set(paneId, host);
    this.publishPresentation(paneId);
    this.attempts.delete(paneId);
    const unsubscribe = readiness.subscribe(() => {
      if (this.active?.panes.some((pane) => pane.paneId === paneId))
        this.cancel();
      this.attempts.delete(paneId);
      host.error = null;
      this.emit(paneId);
      host.surface.requestPaint();
      this.requestFocusedFrame();
      this.wake();
    });
    content.addEventListener("load", readiness.invalidate, true);
    this.wake();
    return () => {
      content.removeEventListener("load", readiness.invalidate, true);
      unsubscribe();
      host.surface.dispose();
      if (this.hosts.get(paneId) === host) {
        this.hosts.delete(paneId);
        this.preloader.forget(paneId);
      }
      if (this.active?.panes.some((pane) => pane.paneId === paneId))
        this.cancel();
    };
  }

  private getDevice(document: Document): Promise<GPUDevice> {
    if (!this.device) {
      const pending = createPaneCanvasDevice(document);
      this.device = pending;
      void pending
        .then(() => {
          if (this.device !== pending) return;
          this.deviceReady = true;
          this.reason = null;
          this.publish();
          this.wake();
        })
        .catch((error: Error) => {
          if (this.device !== pending) return;
          this.captureUnavailable = error.message;
          this.cancel();
          this.publish();
        });
    }
    return this.device;
  }

  private canDraw(paneId: PaneId, host: ContentHost): boolean {
    return Boolean(
      this.root &&
      hostContentReady(host) &&
      this.isLive(paneId) &&
      (this.isContinuous() || this.normalDrawingAllowed(paneId)),
    );
  }

  private normalDrawingAllowed(paneId: PaneId): boolean {
    const item = this.itemsById.get(paneId);
    return Boolean(
      item?.runtimeState === "live" &&
      item.presentationMode === "normal" &&
      !this.isPreloading(paneId) &&
      !this.isOverviewCapture(paneId) &&
      !this.interaction.resizing(),
    );
  }

  private canPrime(paneId: PaneId, host: ContentHost): boolean {
    if (!this.needsFocusedFrame(paneId, host)) return false;
    const bounds = host.content.parentElement!.getBoundingClientRect();
    const view = host.content.ownerDocument.defaultView!;
    return (
      bounds.left >= 0 &&
      bounds.top >= 0 &&
      bounds.right <= view.innerWidth &&
      bounds.bottom <= view.innerHeight
    );
  }

  private needsFocusedFrame(paneId: PaneId, host: ContentHost): boolean {
    return Boolean(
      this.root &&
      this.moving() &&
      this.focused() === paneId &&
      !host.drawn &&
      !this.pictures.has(paneId) &&
      hostContentReady(host) &&
      !this.overview() &&
      !this.isPreloading(paneId) &&
      !this.interaction.resizing(),
    );
  }

  private requestFocusedFrame(): void {
    if (this.focusedPaintFrame !== null) return;
    const id = this.focused();
    const host = id ? this.hosts.get(id) : undefined;
    if (!id || !host || !this.needsFocusedFrame(id, host)) return;
    this.focusedPaintFrame =
      this.root!.ownerDocument.defaultView!.requestAnimationFrame(() => {
        this.focusedPaintFrame = null;
        host.surface.requestPaint();
        this.requestFocusedFrame();
      });
  }

  refresh = (): void => {
    this.attempts.clear();
    this.captureExcluded.clear();
    this.activity();
  };

  activity = (): void => {
    this.noteActivity(true);
  };

  private noteActivity(presentationChanged: boolean): void {
    this.updateResizing();
    this.updateActivation();
    this.preloader.navigation();
    this.epoch++;
    this.overviewAttempts.clear();
    this.deferredSupplied.clear();
    if (!this.overview() || !this.preloadAllowed()) this.setOverviewPane(null);
    if (this.active && !this.valid(this.active)) this.cancel();
    if (presentationChanged || !this.isContinuous())
      for (const [id, host] of this.hosts) {
        host.surface.requestPaint();
        if (this.isContinuous()) this.emit(id);
      }
    this.requestFocusedFrame();
    this.wake();
  }

  private updateResizing(): void {
    for (const host of this.hosts.values())
      host.surface.setResizing(
        !this.isContinuous() && this.interaction.resizing(),
      );
  }

  present = (frame: WorkspacePresentationBoundaryFrame): void => {
    this.frame = frame;
    if (!this.isContinuous()) return;
    const preloading = this.preloader.paneId;
    if (
      preloading &&
      frame.items.some(
        (item) =>
          item.paneId === preloading &&
          paneWorldBoxIntersectsRect(item, frame.world.grid),
      )
    )
      this.preloader.forget(preloading);
    this.updateActivation();
    const moving = this.moving();
    if (this.motionActive !== moving) {
      this.motionActive = moving;
      for (const [id, host] of this.hosts) {
        host.surface.requestPaint();
        this.emit(id);
      }
    }
  };

  private displayScale(paneId: PaneId, host: ContentHost): number {
    const decision = this.decision(paneId);
    if (decision.kind === "texture" && decision.detail === "preview")
      return Math.min(
        1,
        this.configuration.minLongEdgePx /
          Math.max(1, host.content.offsetWidth, host.content.offsetHeight) /
          host.content.ownerDocument.defaultView!.devicePixelRatio,
      );
    if (!this.isContinuous()) return 1;
    const scale = this.frame?.world.scale ?? 1;
    return Math.min(1, 2 ** Math.ceil(Math.log2(Math.max(0.125, scale))));
  }

  private updateActivation(): void {
    if (this.isContinuous()) {
      this.updateContinuousActivation();
      return;
    }
    const items =
      this.moving() || this.interaction.resizing()
        ? []
        : this.configuration.items.filter(
            (item) =>
              item.visible &&
              item.runtimeState === "live" &&
              item.presentationMode === "normal",
          );
    this.activation.update(
      items,
      this.focused(),
      this.root?.ownerDocument.defaultView ?? null,
    );
  }

  private updateContinuousActivation(): void {
    const frame = this.frame;
    const items = frame
      ? frame.items.filter(
          (item) =>
            this.configuration.panes.has(item.paneId) &&
            item.opacity > 0 &&
            paneWorldBoxIntersectsRect(item, frame.world.grid),
        )
      : this.configuration.items.filter((item) => item.visible);
    const visible = new Set(items.map((item) => item.paneId));
    const previous = this.visibleIds;
    this.visibleIds = visible;
    this.activation.updateImmediate(
      items.filter((item) => {
        const kind = this.decision(item.paneId).kind;
        return kind === "dom" || kind === "canvas";
      }),
    );
    for (const id of new Set([...previous, ...visible]))
      if (previous.has(id) !== visible.has(id)) {
        const host = this.hosts.get(id);
        if (!visible.has(id) && host && this.decision(id).kind === "texture")
          host.surface.clear();
        this.emit(id);
      }
  }

  private cancel(): void {
    if (this.active && !this.active.abort.signal.aborted) {
      this.invalidated++;
      this.active.abort.abort();
      for (const pane of this.active.panes)
        if (this.attempts.get(pane.paneId)?.key === pane.key)
          this.attempts.delete(pane.paneId);
      this.publish();
    }
  }

  private wake(delay = 0): void {
    if (!this.root) return;
    const at = Date.now() + delay;
    if (this.timer !== undefined && this.timerAt <= at) return;
    clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.timerAt = Infinity;
      void this.tick();
    }, delay);
  }

  private idle(): boolean {
    return this.browserReady() && this.interaction.idle() && !this.moving();
  }

  private preloadAllowed(): boolean {
    return (
      this.captureUnavailable === null &&
      this.browserReady() &&
      this.interaction.canPreload() &&
      (!this.isContinuous() || (!this.moving() && !this.overview()))
    );
  }

  private browserReady(): boolean {
    const root = this.root;
    if (!root) return false;
    const view = root.ownerDocument.defaultView;
    if (!view) return false;
    return !root.ownerDocument.hidden && this.viewportReady;
  }

  private async tick(): Promise<void> {
    if (!this.root) return;
    if (this.busy || !this.preloadAllowed()) {
      this.wake(100);
      return;
    }
    this.busy = true;
    try {
      await this.pictures.reconcile(() => this.preloadAllowed());
      if (!this.idle()) {
        if (!this.moving()) this.preloadAdjacentContent();
        return;
      }
      await this.resolveSupplied();
      if (!this.idle()) return;
      await this.acquireContent();
    } finally {
      this.active = null;
      this.busy = false;
      this.publish();
      this.wake(100);
    }
  }

  private async acquireContent(): Promise<void> {
    if (this.isContinuous()) {
      this.preloadAdjacentContent();
      return;
    }
    const view = this.root!.ownerDocument.defaultView;
    if (!this.deviceReady || !view) {
      this.preloadAdjacentContent();
      return;
    }
    if (this.overview()) this.prepareOverviewPane();
    else this.setOverviewPane(null);
    if (!this.overview() && !this.activation.settled()) return;
    const panes = this.candidates();
    if (!panes.length) {
      if (!this.overviewPane) this.preloadAdjacentContent();
      return;
    }
    this.preloader.activity();
    const batch = this.beginBatch(panes.slice(0, 1), view);
    this.publish();
    await this.captureWithDeadline(batch);
  }

  private async captureWithDeadline(batch: Batch): Promise<void> {
    const deadline = setTimeout(() => {
      if (this.active !== batch || batch.abort.signal.aborted) return;
      this.reason = "Pane capture timed out";
      this.cancel();
    }, 10000);
    try {
      await this.capture(batch);
    } finally {
      clearTimeout(deadline);
      const id = batch.panes[0]?.paneId;
      if (id && this.isOverviewCapture(id) && !this.pictures.has(id))
        this.setOverviewPane(null);
    }
  }

  private beginBatch(panes: Candidate[], view: Window, preload = false): Batch {
    const abort = new AbortController();
    const batch: Batch = {
      abort,
      id: view.crypto.randomUUID(),
      devicePixelRatio: view.devicePixelRatio,
      preload,
      overview: this.overview() && !preload,
      panes,
    };
    for (const pane of panes) {
      const old = this.attempts.get(pane.paneId);
      this.attempts.set(pane.paneId, {
        key: pane.key,
        failures: old?.key === pane.key ? old.failures : 0,
        retryAt: Infinity,
      });
    }
    this.active = batch;
    return batch;
  }

  private candidates(): Candidate[] {
    const panes: Candidate[] = [];
    for (const item of orderPaneActivation(
      this.configuration.items,
      this.focused(),
    )) {
      const candidate = this.candidate(item);
      if (candidate) panes.push(candidate);
    }
    return panes;
  }

  private captureEligible(item: PaneRenderItem): boolean {
    if (!item.visible) return false;
    if (this.overview())
      return (
        this.isOverviewCapture(item.paneId) && !this.pictures.has(item.paneId)
      );
    return !item.placeholderOnly && item.runtimeState === "live";
  }

  private candidate(item: PaneRenderItem): Candidate | null {
    if (!this.captureEligible(item)) return null;
    const pane = this.configuration.panes.get(item.paneId);
    const host = this.hosts.get(item.paneId);
    if (!pane || !host || !hostReady(host)) return null;
    if (this.configuration.resolver?.(pane)) return null;
    return this.candidateAtBounds(pane, host, !this.overview());
  }

  private candidateAtBounds(
    pane: WorkspacePane,
    host: ContentHost,
    recorded = false,
  ): Candidate | null {
    if (
      !this.canAcquire(pane.paneId, host) ||
      !captureContentHasSize(host.content)
    )
      return null;
    const revision = host.readiness.revision;
    const frame = recorded
      ? `frame-${host.surface.frameVersion}`
      : `epoch-${this.epoch}`;
    const key = `${frame}:${revision}:${host.content.offsetWidth}:${host.content.offsetHeight}`;
    const attempt = this.attempts.get(pane.paneId);
    if (attempt?.key === key && Date.now() < attempt.retryAt) return null;
    return {
      ...host,
      paneId: pane.paneId,
      pane,
      revision,
      bounds: new DOMRect(
        0,
        0,
        host.content.offsetWidth,
        host.content.offsetHeight,
      ),
      key,
    };
  }

  private valid(batch: Batch): boolean {
    const valid =
      !batch.abort.signal.aborted &&
      this.preloadAllowed() &&
      (!batch.overview || this.isOverviewCapture(batch.panes[0]!.paneId)) &&
      batch.panes.every((pane) => this.currentCandidate(pane));
    if (!valid) this.cancel();
    return valid;
  }

  private currentCandidate(candidate: Candidate): boolean {
    const pane = this.configuration.panes.get(candidate.paneId);
    const host = this.hosts.get(candidate.paneId);
    if (!pane || !host) return false;
    return (
      host.surface === candidate.surface &&
      hostReady(host) &&
      samePictureSurface(pane, candidate.pane) &&
      candidate.revision === host.readiness.revision &&
      candidate.content.isConnected &&
      candidate.content.offsetWidth === candidate.bounds.width &&
      candidate.content.offsetHeight === candidate.bounds.height
    );
  }

  private async capture(batch: Batch): Promise<boolean> {
    try {
      if (!this.valid(batch)) return false;
      const pane = batch.panes[0]!;
      const result = await pane.surface.capture({
        signal: batch.abort.signal,
        stage: batch.preload || this.isOverviewCapture(pane.paneId),
        maxEncodedBytes,
        maxRasterBytes,
      });
      if (!this.valid(batch)) return false;
      const accepted = await this.accept(
        pane.paneId,
        { image: result.image, fit: "fill" },
        result,
        () => this.valid(batch),
        {
          evict: !batch.preload,
          capture: {
            id: batch.id,
            devicePixelRatio: batch.devicePixelRatio,
            pixelsPerCss: {
              x: result.width / pane.bounds.width,
              y: result.height / pane.bounds.height,
            },
            bounds: {
              x: 0,
              y: 0,
              width: pane.bounds.width,
              height: pane.bounds.height,
            },
          },
        },
      );
      if (!accepted) {
        const attempt = this.attempts.get(pane.paneId);
        if (attempt) attempt.retryAt = Date.now() + 1000;
      }
      this.reason = null;
      return accepted;
    } catch (error) {
      this.captureFailed(batch, error);
      return false;
    }
  }

  private async capturePreload(
    paneId: PaneId,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (this.busy || !this.deviceReady || !this.root) return false;
    const host = this.hosts.get(paneId);
    const pane = this.configuration.panes.get(paneId);
    if (!host || !pane) return false;
    const candidate = this.candidateAtBounds(pane, host);
    if (!candidate) return false;
    this.busy = true;
    const batch = this.beginBatch(
      [candidate],
      this.root.ownerDocument.defaultView!,
      true,
    );
    const abort = () => batch.abort.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const deadline = setTimeout(() => batch.abort.abort(), 10000);
    this.publish();
    try {
      return await this.capture(batch);
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      if (this.active === batch) this.active = null;
      this.busy = false;
      this.publish();
      this.wake();
    }
  }

  private captureFailed(batch: Batch, error: unknown): void {
    if (batch.abort.signal.aborted) return;
    this.rejected++;
    this.reason =
      error instanceof Error
        ? error.message.slice(0, 200)
        : "Pane capture failed";
    for (const pane of batch.panes) {
      const attempt = this.attempts.get(pane.paneId);
      if (!attempt) continue;
      attempt.failures++;
      attempt.retryAt =
        attempt.failures < 3
          ? Date.now() + 250 * 2 ** (attempt.failures - 1)
          : Infinity;
    }
  }

  private async resolveSupplied(): Promise<void> {
    for (const [id, pane] of this.configuration.panes) {
      if (!this.idle()) return;
      const supplied = this.configuration.resolver?.(pane);
      if (supplied && !(await this.resolveSource(id, pane, supplied))) return;
    }
  }

  private updatePictureStyle(id: PaneId, supplied: OnirigiriPanePicture): void {
    const accepted = this.pictures.get(id);
    if (
      !accepted ||
      (accepted.image !== supplied.image &&
        this.supplied.get(id)?.deref() !== supplied.image)
    )
      return;
    const fit = supplied.fit ?? "contain";
    const position = supplied.position ?? "center";
    if (accepted.fit === fit && accepted.position === position) return;
    this.pictures.style(id, fit, position);
  }

  private suppliedCurrent(
    id: PaneId,
    pane: WorkspacePane,
    image: Blob,
    epoch: number,
    resolver: OnirigiriPanePictureResolver | undefined,
  ): boolean {
    return (
      this.idle() &&
      epoch === this.epoch &&
      this.configuration.panes.get(id) === pane &&
      resolver === this.configuration.resolver &&
      resolver?.(pane)?.image === image
    );
  }

  private suppliedAccepted(id: PaneId, image: Blob): boolean {
    return (
      image === this.supplied.get(id)?.deref() &&
      !this.pictures.get(id)?.capture
    );
  }

  private async resolveSource(
    id: PaneId,
    pane: WorkspacePane,
    supplied: OnirigiriPanePicture,
  ): Promise<boolean> {
    this.updatePictureStyle(id, supplied);
    if (
      this.suppliedAccepted(id, supplied.image) ||
      supplied.image === this.deferredSupplied.get(id)?.deref()
    )
      return true;
    this.deferredSupplied.set(id, new WeakRef(supplied.image));
    const epoch = this.epoch;
    const resolver = this.configuration.resolver;
    try {
      const size = await pngDimensions(
        supplied.image,
        maxEncodedBytes,
        maxRasterBytes,
      );
      if (!this.suppliedCurrent(id, pane, supplied.image, epoch, resolver))
        return false;
      await validatePictureDecode(
        this.root!.ownerDocument,
        supplied.image,
        size,
      );
      if (!this.suppliedCurrent(id, pane, supplied.image, epoch, resolver))
        return false;
      if (
        await this.accept(id, supplied, size, () =>
          this.suppliedCurrent(id, pane, supplied.image, epoch, resolver),
        )
      )
        this.supplied.set(id, new WeakRef(supplied.image));
    } catch {
      this.supplied.set(id, new WeakRef(supplied.image));
      this.rejected++;
    }
    return true;
  }

  private async accept(
    id: PaneId,
    source: OnirigiriPanePicture,
    size: { width: number; height: number },
    valid: () => boolean,
    options: { capture?: OnirigiriPaneCaptureReceipt; evict?: boolean } = {},
  ): Promise<boolean> {
    const accepted = await this.pictures.accept(id, source, size, valid, {
      ...options,
      revision: this.accepted + 1,
    });
    if (accepted) this.accepted++;
    else this.rejected++;
    this.publish();
    return accepted;
  }

  private preloadAdjacentContent(): void {
    if (!this.backgroundReady()) return;
    const margin = this.configuration.preloadMarginPanes ?? 0;
    const all =
      (this.configuration.preloadAllPanePictures ||
        this.configuration.liveContent) &&
      this.idle();
    if (!margin && !all) return;
    const stage =
      this.root!.querySelector('[data-onirigiri-slot="stage"]') ?? this.root!;
    const viewport = stage.getBoundingClientRect();
    const candidates = orderPaneActivation(
      this.configuration.items,
      this.focused(),
    ).flatMap((item) => this.preloadCandidate(item, viewport, margin, !!all));
    this.preloader.advance(candidates);
  }

  private backgroundReady(): boolean {
    return Boolean(
      this.deviceReady &&
      this.preloadAllowed() &&
      this.root &&
      (this.moving() || this.activation.settled()),
    );
  }

  private preloadCandidate(
    item: PaneRenderItem,
    viewport: DOMRect,
    margin: number,
    all: boolean,
  ) {
    const host = this.preloadHost(item);
    if (!host) return [];
    const bounds = (
      host.content.closest('[data-onirigiri-slot="pane"]') ?? host.content
    ).getBoundingClientRect();
    const nearby = adjacentPreloadDistance(bounds, viewport, margin);
    if (nearby === null && !all) return [];
    return [
      {
        ...host,
        item,
        current: () => this.currentPreload(item, host),
      },
    ];
  }

  private preloadHost(item: PaneRenderItem): ContentHost | null {
    const host = this.hosts.get(item.paneId);
    if (
      !host ||
      this.frozenSurface(item.paneId, host) ||
      !this.canAcquire(item.paneId, host) ||
      ["dom", "canvas", "placeholder"].includes(
        this.decision(item.paneId).requested,
      ) ||
      (this.isContinuous() && this.isLive(item.paneId)) ||
      this.pictureMatchesContent(item.paneId, host) ||
      this.preloadWouldCoverContent(item, host)
    )
      return null;
    return host;
  }

  private pictureMatchesContent(paneId: PaneId, host: ContentHost): boolean {
    const picture = this.pictures.get(paneId);
    if (!picture) return false;
    if (!picture.capture) return true;
    return (
      picture.capture.bounds.width === host.content.offsetWidth &&
      picture.capture.bounds.height === host.content.offsetHeight
    );
  }

  private canAcquire(paneId: PaneId, host: ContentHost): boolean {
    if (host.mounted() && host.readiness.getSnapshot()) {
      if (host.surface.canCapture()) this.captureExcluded.delete(paneId);
      else this.captureExcluded.add(paneId);
    }
    return !this.captureExcluded.has(paneId);
  }

  private currentPreload(item: PaneRenderItem, host: ContentHost): boolean {
    const current = this.itemsById.get(item.paneId);
    return (
      this.hosts.get(item.paneId) === host &&
      current !== undefined &&
      current.width === item.width &&
      current.height === item.height &&
      !this.preloadWouldCoverContent(current, host)
    );
  }

  private preloadWouldCoverContent(
    item: PaneRenderItem,
    host: ContentHost,
  ): boolean {
    if (this.decision(item.paneId).kind === "texture") return false;
    return (
      (item.visible && item.presentationMode === "normal") ||
      (this.overview() && host.drawn)
    );
  }

  finishOverviewCapture(
    paneId: PaneId,
    picture: CachedPanePicture | null = this.get(paneId),
  ): void {
    if (
      !this.isOverviewCapture(paneId) ||
      !picture ||
      this.get(paneId) !== picture
    )
      return;
    this.setOverviewPane(null);
    this.wake(100);
  }

  private setOverviewPane(paneId: PaneId | null): void {
    const previous = this.overviewPane?.paneId;
    if (previous === paneId || (!previous && !paneId)) return;
    if (paneId) this.preloader.activity();
    this.overviewPane = paneId
      ? { paneId, deadline: Date.now() + 10000 }
      : null;
    if (previous) this.emit(previous);
    if (paneId) this.emit(paneId);
    this.publish();
  }

  private prepareOverviewPane(): void {
    if (!this.configuration.captureMissingOverviewPictures) {
      this.setOverviewPane(null);
      return;
    }
    if (this.overviewPane) {
      if (Date.now() < this.overviewPane.deadline) return;
      this.setOverviewPane(null);
    }
    const view = this.root?.ownerDocument.defaultView;
    if (!view) return;
    const item = orderPaneActivation(
      this.configuration.items,
      this.focused(),
    ).find((item) => this.missingOverviewPicture(item, view));
    if (!item) return;
    this.overviewAttempts.add(item.paneId);
    this.setOverviewPane(item.paneId);
  }

  private overviewPicturePending(item: PaneRenderItem): boolean {
    return (
      item.visible &&
      !this.pictures.has(item.paneId) &&
      !this.overviewAttempts.has(item.paneId)
    );
  }

  private missingOverviewPicture(item: PaneRenderItem, view: Window): boolean {
    if (!this.overviewPicturePending(item)) return false;
    const pane = this.configuration.panes.get(item.paneId);
    const host = this.hosts.get(item.paneId);
    if (!pane || !host || this.configuration.resolver?.(pane)) return false;
    return (
      this.canAcquire(item.paneId, host) &&
      host.content.isConnected &&
      view.innerWidth > 0
    );
  }

  private presentationPhase(): PanePresentationPhase {
    const moving = this.moving();
    if (this.interaction.resizing()) return "resize";
    if (this.overview()) return moving ? "overview-motion" : "overview";
    return moving ? "motion" : "rest";
  }

  private contentCapabilities(host: ContentHost | undefined) {
    return {
      canCapture:
        host && host.mounted() && host.readiness.getSnapshot()
          ? host.surface.canCapture()
          : null,
      hasVideo: host?.surface.hasVideo() ?? false,
    };
  }

  private decision(paneId: PaneId): ResolvedPanePresentation {
    const pane = this.configuration.panes.get(paneId);
    if (!pane) return defaultPresentation;
    const host = this.hosts.get(paneId);
    const item = this.itemsById.get(paneId);
    return this.policy.resolve(pane, {
      phase: this.presentationPhase(),
      focused: this.focused() === paneId,
      maximized: item?.maximized ?? false,
      visible: this.paneVisible(paneId),
      capabilities: this.contentCapabilities(host),
    });
  }

  getPresentation = (paneId: PaneId): PanePresentationState =>
    this.presentations.get(paneId) ?? initialPresentation;

  presentCover(paneId: PaneId, cover: "texture" | "placeholder" | null): void {
    if (cover === null) this.covers.delete(paneId);
    else this.covers.set(paneId, cover);
    const host = this.hosts.get(paneId);
    if (!host || host.cover === cover) return;
    host.cover = cover;
    this.emit(paneId);
  }

  private presentationCovered(
    paneId: PaneId,
    host: ContentHost,
    decision: ResolvedPanePresentation,
    frozen: boolean,
  ): boolean {
    return (
      policyNeedsCover(host, decision, frozen) ||
      !hostContentReady(host) ||
      !host.drawn ||
      this.isOverviewCapture(paneId) ||
      this.isPreloading(paneId)
    );
  }

  private presentationState(
    paneId: PaneId,
    host: ContentHost,
  ): PanePresentationState {
    const decision = this.decision(paneId);
    const picture = this.pictures.get(paneId);
    const frozen = this.frozenSurface(paneId, host, decision);
    const covered = this.presentationCovered(paneId, host, decision, frozen);
    const live = !covered && this.isLive(paneId);
    const actual = visiblePaneRenderer(host, covered, live);
    return {
      ...decision,
      reason:
        decision.kind === "texture" && !picture && !frozen
          ? "texture-unavailable"
          : decision.reason,
      actual,
      live: live && (actual === "dom" || actual === "canvas"),
      covered,
    };
  }

  private publishPresentation(paneId: PaneId): void {
    const host = this.hosts.get(paneId);
    if (!host) return;
    const next = this.presentationState(paneId, host);
    const previous = this.presentations.get(paneId);
    if (
      previous &&
      Object.keys(next).every(
        (key) =>
          next[key as keyof PanePresentationState] ===
          previous[key as keyof PanePresentationState],
      )
    )
      return;
    this.presentations.set(paneId, next);
    this.pictures.setDetail(
      paneId,
      next.kind === "texture" ? next.detail : "full",
    );
    const pane = host.content.closest<HTMLElement>("[data-onirigiri-pane-id]");
    if (pane) {
      pane.dataset.onirigiriRenderer = next.actual;
      pane.dataset.onirigiriPresentationLive = String(next.live);
      pane.dataset.onirigiriPresentationRequested = next.requested;
      pane.dataset.onirigiriPresentationReason = next.reason;
      pane.dataset.onirigiriPresentationVariant = next.variant;
    }
    this.configuration.onPresentationChange?.(paneId, next);
  }

  private emit(id: PaneId): void {
    this.publishPresentation(id);
    for (const listener of this.listeners.get(id) ?? []) listener();
  }

  private paneVisible(paneId: PaneId): boolean {
    return this.frame
      ? this.visibleIds.has(paneId)
      : this.itemsById.get(paneId)?.visible === true;
  }

  private frozenSurface(
    paneId: PaneId,
    host: ContentHost,
    decision = this.decision(paneId),
  ): boolean {
    return (
      decision.kind === "texture" &&
      this.paneVisible(paneId) &&
      host.mounted() &&
      host.readiness.getSnapshot() &&
      host.surface.canCapture() &&
      this.pictures.get(paneId)?.capture !== null
    );
  }

  private captureState(): OnirigiriCaptureStatus["state"] {
    if (this.captureUnavailable !== null || this.reason) return "unavailable";
    if (!this.device) return "unconfigured";
    return this.active || this.overviewPane ? "capturing" : "idle";
  }

  private publish(): void {
    const next: OnirigiriCaptureStatus = {
      state: this.captureState(),
      reason: this.captureUnavailable ?? this.reason,
      pictureBytes: this.pictures.bytes,
      pictureRasterBytes: this.pictures.rasterBytes,
      overviewPaneId: this.overviewPane?.paneId ?? null,
      preloadingPaneId: this.preloader.paneId,
      pictures: [...this.pictures].map(([paneId, picture]) => ({
        paneId,
        revision: picture.revision,
        capture: picture.capture,
        width: picture.width,
        height: picture.height,
        pixelated: picture.pixelated,
      })),
      inFlightPaneIds: this.active?.panes.map((pane) => pane.paneId) ?? [],
      accepted: this.accepted,
      rejected: this.rejected,
      invalidated: this.invalidated,
    };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.configuration.onStatus?.(next);
  }
}

function hostReady(host: ContentHost): boolean {
  return !host.error && hostContentReady(host);
}

function hostContentReady(host: ContentHost): boolean {
  return host.mounted() && host.readiness.getSnapshot();
}

function captureViewportReady(
  viewport: VisualViewport | null | undefined,
): boolean {
  return (
    !viewport ||
    (viewport.scale === 1 &&
      viewport.offsetLeft === 0 &&
      viewport.offsetTop === 0)
  );
}

const defaultPresentation: ResolvedPanePresentation = {
  requested: "auto",
  kind: "dom",
  detail: "full",
  variant: "icon",
  reason: "native-presentation",
};
const initialPresentation: PanePresentationState = {
  ...defaultPresentation,
  actual: "loading",
  live: false,
  covered: true,
};

function policyNeedsCover(
  host: ContentHost,
  decision: ResolvedPanePresentation,
  frozen: boolean,
): boolean {
  return (
    (decision.kind === "texture" &&
      !(frozen && host.drawn && host.renderer === "canvas")) ||
    decision.kind === "placeholder"
  );
}

function visiblePaneRenderer(
  host: ContentHost,
  covered: boolean,
  live: boolean,
): PanePresentationState["actual"] {
  const actual = (covered ? host.cover : null) ?? host.renderer ?? "loading";
  if (host.error) return "error";
  return actual === "canvas" && !live ? "texture" : actual;
}

function renderedContent(
  host: ContentHost,
  drawn: boolean,
  renderer: PaneLiveRenderer | undefined,
): PaneLiveRenderer | null {
  return drawn ? (renderer ?? host.renderer) : null;
}

function captureContentHasSize(content: HTMLElement): boolean {
  return (
    content.isConnected && content.offsetWidth >= 1 && content.offsetHeight >= 1
  );
}
