import { PaneContentPreloader } from "../panes/pane-content-preloader.js";
import type { PaneContentReadiness } from "../panes/pane-content-readiness.js";
import {
  PanePresentationPolicy,
  type PaneLiveRenderer,
  type PanePresentationPhase,
  type PanePresentationState,
  type ResolvedPanePresentation,
} from "../presentation/pane-presentation-policy.js";
import type { WorkspacePresentationBoundaryFrame } from "../presentation/workspace-frame-scheduler.js";
import { paneWorldBoxIntersectsRect } from "../presentation/workspace-sweep-geometry.js";
import type { PaneId, PaneRenderItem, WorkspacePane } from "../types.js";
import { PanePictureActivation } from "./pane-picture-activation.js";
import { PanePictureActivity } from "./pane-picture-activity.js";
import {
  PanePictureCache,
  type CachedPanePicture,
} from "./pane-picture-cache.js";
import {
  createPaneCanvasDevice,
  PaneCanvasSurface,
} from "./pane-picture-canvas.js";
import { PanePictureCaptureClient } from "./pane-picture-capture-client.js";
import {
  acquisitionChanged,
  resolveConfiguration,
  samePictureSurface,
  type Configuration,
  type ResolvedConfiguration,
} from "./pane-picture-configuration.js";
import { preparePanePictureTexture } from "./pane-picture-texture.js";
import type { OnirigiriCaptureStatus } from "./pane-picture-types.js";

export interface ContentHost {
  content: HTMLElement;
  readiness: PaneContentReadiness;
  mounted: () => boolean;
  surface: PaneCanvasSurface;
  drawn: boolean;
  error: string | null;
  renderer: PaneLiveRenderer | null;
  cover: "texture" | "placeholder" | null;
}

export interface Candidate extends ContentHost {
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

export interface Batch {
  id: string;
  devicePixelRatio: number;
  preload: boolean;
  overview: boolean;
  abort: AbortController;
  panes: Candidate[];
}

export const maxEncodedBytes = 32 * 1024 * 1024;

export const maxRasterBytes = 128 * 1024 * 1024;

export function hostReady(host: ContentHost): boolean {
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

export function captureContentHasSize(content: HTMLElement): boolean {
  return (
    content.isConnected && content.offsetWidth >= 1 && content.offsetHeight >= 1
  );
}

export abstract class PanePicturePresentation {
  protected captureWorker: PanePictureCaptureClient | null = null;

  protected readonly pictures = new PanePictureCache(
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

  protected readonly hosts = new Map<PaneId, ContentHost>();

  protected itemsById = new Map<PaneId, PaneRenderItem>();

  protected readonly covers = new Map<PaneId, "texture" | "placeholder">();

  protected readonly policy = new PanePresentationPolicy();

  protected readonly presentations = new Map<PaneId, PanePresentationState>();

  protected visibleIds = new Set<PaneId>();

  protected frame: WorkspacePresentationBoundaryFrame | null = null;

  protected motionActive = false;

  protected readonly listeners = new Map<PaneId, Set<() => void>>();

  protected readonly attempts = new Map<PaneId, Attempt>();

  protected readonly captureExcluded = new Set<PaneId>();

  protected readonly supplied = new Map<
    PaneId,
    { image: WeakRef<Blob>; failed: boolean }
  >();

  protected readonly seeds = new Map<PaneId, Blob>();

  protected readonly stalePictures = new Set<PaneId>();

  protected readonly retiredSeeds = new Map<PaneId, WeakRef<Blob>>();

  protected readonly deferredSupplied = new Map<PaneId, WeakRef<Blob>>();

  protected configuration: ResolvedConfiguration = {
    panes: new Map(),
    items: [],
    budgetBytes: 256 * 1024 * 1024,
    rasterBudgetBytes: 256 * 1024 * 1024,
    minLongEdgePx: 128,
  };

  protected root: HTMLElement | null = null;

  protected viewportReady = true;

  protected device: Promise<GPUDevice> | null = null;

  protected deviceReady = false;

  protected captureUnavailable: string | null = null;

  protected readonly preloader = new PaneContentPreloader(
    (paneId) => {
      this.emit(paneId);
      this.publish();
      this.wake();
    },
    () =>
      this.preloadAllowed() &&
      !this.moving() &&
      (!this.isContinuous() || this.idle()),
    () => this.idle(),
    (paneId, signal) => this.capturePreload(paneId, signal),
    () => !this.busy,
  );

  isPreloading = (paneId: PaneId): boolean => this.preloader.paneId === paneId;

  protected readonly activation = new PanePictureActivation((id) => {
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

  acceptsContentInput = (): boolean =>
    !this.overview() && !this.interaction.resizing();

  protected readonly interaction = new PanePictureActivity(
    (presentationChanged) => this.noteActivity(presentationChanged),
    (target) => this.preparingContent(target),
  );

  protected timer: ReturnType<typeof setTimeout> | undefined;

  protected timerAt = Infinity;

  protected focusedPaintFrame: number | null = null;

  protected active: Batch | null = null;

  protected busy = false;

  protected epoch = 0;

  protected overviewPane: { paneId: PaneId; deadline: number } | null = null;

  protected readonly overviewAttempts = new Set<PaneId>();

  protected accepted = 0;

  protected rejected = 0;

  protected invalidated = 0;

  protected reason: string | null = null;

  protected status: OnirigiriCaptureStatus = {
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
    protected readonly moving: () => boolean,
    protected readonly focused: () => PaneId | null,
    protected readonly overview: () => boolean = () => false,
  ) {}

  get = (paneId: PaneId): CachedPanePicture | null =>
    this.captureUnavailable === null ? this.pictures.get(paneId) : null;

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

  protected refreshSurfaces(): void {
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

  protected reconcileIdentities(
    panes: ReadonlyMap<PaneId, WorkspacePane>,
  ): void {
    for (const [id, pane] of this.configuration.panes) {
      const next = panes.get(id);
      if (!next || !samePictureSurface(pane, next)) {
        this.preloader.forget(id);
        this.pictures.release(id);
        this.supplied.delete(id);
        this.deferredSupplied.delete(id);
        this.seeds.delete(id);
        this.stalePictures.delete(id);
        this.retiredSeeds.delete(id);
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
      this.captureWorker?.dispose();
      this.captureWorker = null;
      void this.device?.then((device) => device.destroy()).catch(() => {});
      this.device = null;
      this.deviceReady = false;
      this.activity();
      for (const id of this.pictures.keys()) this.pictures.release(id);
      this.supplied.clear();
      this.seeds.clear();
      this.stalePictures.clear();
      this.retiredSeeds.clear();
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
          visible: () => this.paneVisible(paneId),
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
    let contentRevision = readiness.contentRevision;
    const unsubscribe = readiness.subscribe(() => {
      if (this.active?.panes.some((pane) => pane.paneId === paneId))
        this.cancel();
      if (readiness.contentRevision !== contentRevision) {
        contentRevision = readiness.contentRevision;
        const seeded = this.isSeed(paneId);
        if (seeded) this.retireSeed(paneId);
        if (seeded || this.pictures.get(paneId)?.capture) {
          this.stalePictures.add(paneId);
          this.preloader.forget(paneId);
          this.overviewAttempts.delete(paneId);
        }
      }
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

  protected getDevice(document: Document): Promise<GPUDevice> {
    if (this.captureUnavailable !== null)
      return Promise.reject(new Error(this.captureUnavailable));
    if (!this.device) {
      const pending = createPaneCanvasDevice(document);
      this.device = pending;
      void pending
        .then((device) => {
          if (this.device !== pending) return;
          this.deviceReady = true;
          this.reason = null;
          this.publish();
          this.wake();
          void device.lost.then((info) => {
            if (this.device !== pending) return;
            this.deviceUnavailable(
              new Error(`Onirigiri WebGPU device lost: ${info.message}`),
            );
          });
        })
        .catch((error: Error) => {
          if (this.device !== pending) return;
          this.deviceUnavailable(error);
        });
    }
    return this.device;
  }

  protected deviceUnavailable(error: Error): void {
    this.captureUnavailable = error.message;
    this.deviceReady = false;
    this.cancel();
    this.setOverviewPane(null);
    this.preloader.activity();
    for (const id of new Set([...this.hosts.keys(), ...this.pictures.keys()]))
      this.emit(id);
    this.publish();
  }

  protected canDraw(paneId: PaneId, host: ContentHost): boolean {
    return Boolean(
      this.root &&
      hostContentReady(host) &&
      this.isLive(paneId) &&
      (this.isContinuous() || this.normalDrawingAllowed(paneId)),
    );
  }

  protected normalDrawingAllowed(paneId: PaneId): boolean {
    const item = this.itemsById.get(paneId);
    return Boolean(
      item?.runtimeState === "live" &&
      item.presentationMode === "normal" &&
      !this.isPreloading(paneId) &&
      !this.isOverviewCapture(paneId) &&
      !this.interaction.resizing(),
    );
  }

  protected canPrime(paneId: PaneId, host: ContentHost): boolean {
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

  protected needsFocusedFrame(paneId: PaneId, host: ContentHost): boolean {
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

  protected requestFocusedFrame(): void {
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

  protected preparingContent(target: EventTarget | null): boolean {
    const paneId = this.preloader.paneId;
    return (
      paneId !== null &&
      this.itemsById.get(paneId)?.visible === false &&
      target instanceof Node &&
      this.hosts.get(paneId)?.content.contains(target) === true
    );
  }

  protected noteActivity(presentationChanged: boolean): void {
    this.updateActivation();
    this.preloader.navigation();
    this.epoch++;
    this.overviewAttempts.clear();
    this.deferredSupplied.clear();
    if (!this.overview() || !this.preloadAllowed()) this.setOverviewPane(null);
    if (this.active && !this.valid(this.active)) this.cancel();
    this.updateResizing();
    if (presentationChanged || !this.isContinuous())
      for (const [id, host] of this.hosts) {
        host.surface.requestPaint();
        if (this.isContinuous()) this.emit(id);
      }
    this.requestFocusedFrame();
    this.wake();
  }

  protected updateResizing(): void {
    PaneCanvasSurface.resizeAll(
      [...this.hosts.values()].map((host) => host.surface),
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

  protected displayScale(paneId: PaneId, host: ContentHost): number {
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

  protected updateActivation(): void {
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

  protected updateContinuousActivation(): void {
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

  protected presentationPhase(): PanePresentationPhase {
    const moving = this.moving();
    if (this.interaction.resizing()) return "resize";
    if (this.overview()) return moving ? "overview-motion" : "overview";
    return moving ? "motion" : "rest";
  }

  protected contentCapabilities(host: ContentHost | undefined) {
    return {
      canCapture:
        this.captureUnavailable !== null
          ? false
          : host && host.mounted() && host.readiness.getSnapshot()
            ? host.surface.canCapture()
            : null,
      hasVideo: host?.surface.hasVideo() ?? false,
    };
  }

  protected decision(paneId: PaneId): ResolvedPanePresentation {
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

  protected presentationCovered(
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

  protected presentationState(
    paneId: PaneId,
    host: ContentHost,
  ): PanePresentationState {
    const decision = this.decision(paneId);
    const picture = this.get(paneId);
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

  protected publishPresentation(paneId: PaneId): void {
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

  protected emit(id: PaneId): void {
    this.publishPresentation(id);
    for (const listener of this.listeners.get(id) ?? []) listener();
  }

  protected paneVisible(paneId: PaneId): boolean {
    return this.isContinuous() && this.frame
      ? this.visibleIds.has(paneId)
      : this.itemsById.get(paneId)?.visible === true;
  }

  protected frozenSurface(
    paneId: PaneId,
    host: ContentHost,
    decision = this.decision(paneId),
  ): boolean {
    return (
      this.captureUnavailable === null &&
      decision.kind === "texture" &&
      this.paneVisible(paneId) &&
      host.mounted() &&
      host.readiness.getSnapshot() &&
      host.surface.canCapture() &&
      this.pictures.get(paneId)?.capture !== null
    );
  }

  protected abstract cancel(): void;
  protected abstract wake(delay?: number): void;
  protected abstract idle(): boolean;
  protected abstract preloadAllowed(): boolean;
  protected abstract valid(batch: Batch): boolean;
  protected abstract capturePreload(
    paneId: PaneId,
    signal: AbortSignal,
  ): Promise<boolean>;
  protected abstract isSeed(id: PaneId): boolean;
  protected abstract retireSeed(id: PaneId): void;
  protected abstract setOverviewPane(paneId: PaneId | null): void;
  protected abstract publish(): void;
}
