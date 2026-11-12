import type { PaneLiveRenderer } from "../presentation/pane-presentation-policy.js";
import {
  documentLiveCopyBudget,
  type LiveCopyBudget,
} from "./pane-live-copy-budget.js";
import {
  canDrawElementImages,
  drawElementImage,
  elementImageWidth,
  markElementCanvas,
  type ElementCanvas,
  type ElementImage,
  type ElementPaintEvent,
} from "./pane-picture-canvas-api.js";
import {
  paneCanvasRasterSize,
  readPaneCanvasTexture,
} from "./pane-picture-canvas-readback.js";
import { stagePaneCanvas } from "./pane-picture-canvas-stage.js";
import { PanePictureCaptureClient } from "./pane-picture-capture-client.js";
import { PanePictureContent } from "./pane-picture-content.js";
import { PanePictureResize } from "./pane-picture-resize.js";
import {
  displayPaneCapture,
  preparePaneCaptureDisplay,
} from "./pane-picture-texture.js";

declare const GPUTextureUsage: {
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly TEXTURE_BINDING: number;
  readonly RENDER_ATTACHMENT: number;
};

interface PaneCanvasSnapshotRequest {
  signal: AbortSignal;
  stage: boolean;
  maxRasterBytes: number;
  maxEncodedBytes: number;
  recorded?: () => void;
  background?: {
    client: PanePictureCaptureClient;
    id: string;
    required?: boolean;
  };
}

interface PaneCanvasCallbacks {
  continuous(): boolean;
  canDraw(): boolean;
  canPrime(): boolean;
  visible(): boolean;
  renderer(): PaneLiveRenderer;
  frozen?(): boolean;
  videoFrames?(): boolean;
  interactive?(): boolean;
  changed?(): void;
  displayScale(): number;
  revision(): number;
  drawn(ready: boolean, renderer?: PaneLiveRenderer): void;
  failed(error: Error): void;
}

const paneCanvasRequirement =
  "Retained pane pictures require WebGPU and HTML-in-Canvas (chrome://flags/#canvas-draw-element); panes present native content without them.";

export async function createPaneCanvasDevice(
  document: Document,
): Promise<GPUDevice> {
  const canvas = document.createElement("canvas") as ElementCanvas;
  const gpu = document.defaultView?.navigator.gpu;
  if (
    !gpu ||
    typeof canvas.captureElementImage !== "function" ||
    typeof canvas.requestPaint !== "function" ||
    typeof canvas.showPopover !== "function" ||
    typeof canvas.moveBefore !== "function"
  )
    throw new Error(paneCanvasRequirement);
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("Onirigiri could not acquire a WebGPU adapter");
  const device = await adapter.requestDevice();
  if (!canDrawElementImages(device.queue)) {
    device.destroy();
    throw new Error(paneCanvasRequirement);
  }
  return device;
}

const contentSurfaces = new WeakMap<HTMLElement, PaneCanvasSurface>();
const pictureWorkers = new WeakMap<
  Document,
  {
    client: PanePictureCaptureClient;
    owners: Set<PaneCanvasSurface>;
    active: boolean;
  }
>();

function pictureWorkerFor(document: Document) {
  let worker = pictureWorkers.get(document);
  if (!worker) {
    worker = {
      client: new PanePictureCaptureClient(document),
      owners: new Set<PaneCanvasSurface>(),
      active: false,
    };
    pictureWorkers.set(document, worker);
  }
  return worker;
}

export async function captureOnirigiriPanePicture(
  element: HTMLElement,
  signal: AbortSignal,
  recorded?: () => void,
): Promise<{ image: Blob; cssSize: { width: number; height: number } } | null> {
  signal.throwIfAborted();
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const surface = contentSurfaces.get(node);
    if (surface) return surface.capturePicture(signal, recorded);
  }
  return null;
}

export class PaneCanvasSurface {
  private readonly canvas: ElementCanvas;

  private readonly resize: ResizeObserver;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private initialized = false;
  private captureAbort: AbortController | null = null;
  private disposed = false;
  private unwatchDeviceLoss: (() => void) | null = null;
  private readonly presentation: PanePictureResize;
  private readonly source: PanePictureContent;
  private live = false;
  private resizing = false;
  private freezePending = false;
  private lastImage: ElementImage | null = null;
  private imageSize: { width: number; height: number } | null = null;
  private imageRevision = -1;
  private imageVersion = 0;
  private recordingScale = 1;
  private frozenScale: number | null = null;
  private nativeOnly = false;
  private refreshPending = false;
  private readonly copyBudget: LiveCopyBudget;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly content: HTMLElement,
    device: Promise<GPUDevice>,
    private readonly callbacks: PaneCanvasCallbacks,
  ) {
    this.canvas = canvas as ElementCanvas;
    contentSurfaces.set(content, this);
    this.copyBudget = documentLiveCopyBudget(canvas.ownerDocument);
    this.presentation = new PanePictureResize(canvas, content);
    let primeNative = false;
    this.source = new PanePictureContent(canvas, content, {
      canPresent: () => {
        if (this.presentationBlocked() || !this.nativeRequested()) return false;
        if (!this.hasCurrentFrame()) return true;
        if (!this.initialized) return false;
        primeNative = this.canPrimeNative();
        return (
          this.nativeOnly ||
          callbacks.canDraw() ||
          primeNative ||
          this.canRestoreNativeContent()
        );
      },
      changed: () => {
        callbacks.changed?.();
        this.requestPaint();
      },
      interactive: () => callbacks.interactive?.() === true,
      presented: () => {
        this.canvas.clearElementGeometry?.(this.content);
        this.presentation.restore();
        this.source.prepare(false);
        if (primeNative) {
          this.source.reveal(false);
          callbacks.drawn(true, "dom");
        }
        this.requestPaint();
      },
    });
    this.applyRecordingScale();
    markElementCanvas(canvas);
    content.setAttribute("drawable", "");
    canvas.addEventListener("paint", this.paint);
    this.resize = new ResizeObserver(this.requestPaint);
    this.resize.observe(content);
    void device
      .then(this.initialize, this.captureUnavailable)
      .catch(this.failed);
  }

  requestPaint = (): void => {
    if (this.disposed) return;
    this.updateLiveState();
    const native = this.nativeRequested();
    const primeNative =
      !this.live && !this.captureAbort && native && this.canPrimeNative();
    this.updateVideoPresentation(native);
    this.updateFrozenScale();
    if (this.usesNativePresentation(native, primeNative)) {
      this.requestNativePresentation(primeNative);
      return;
    }
    this.requestCanvasPresentation(native, primeNative);
  };

  private updateVideoPresentation(native?: boolean): void {
    this.source.presentVideos(
      this.live &&
        this.source.isNative() &&
        (native ?? this.nativeRequested()) &&
        this.callbacks.videoFrames?.() === true,
    );
  }

  private updateFrozenScale(): void {
    const frozenScale = this.callbacks.frozen?.()
      ? this.callbacks.displayScale()
      : null;
    if (
      frozenScale !== null &&
      (this.frozenScale !== frozenScale || !this.hasCurrentFrame())
    )
      this.freezePending = true;
    this.frozenScale = frozenScale;
  }

  private requestNativePresentation(primeNative: boolean): void {
    this.source.prepare(false);
    const display = this.live || primeNative || !this.hasCurrentFrame();
    if (display && this.source.isNative()) {
      this.source.reveal(this.live);
      this.callbacks.drawn(true, "dom");
    }
    if (display || this.nativeOnly || this.canRestoreNativeContent())
      this.source.present();
  }

  private presentationBlocked(): boolean {
    return this.disposed || this.resizing || this.captureAbort !== null;
  }

  private canPrimeNative(): boolean {
    return !this.callbacks.continuous() && this.callbacks.canPrime();
  }

  private canRestoreNativeContent(): boolean {
    return (
      this.callbacks.continuous() &&
      this.callbacks.interactive?.() === true &&
      this.source.hasNativeHost()
    );
  }

  private canvasPaintRequested(prime?: boolean): boolean {
    return Boolean(
      this.live ||
      (this.freezePending && this.callbacks.visible()) ||
      this.captureAbort ||
      (prime ?? this.callbacks.canPrime()),
    );
  }

  private nativeRequested(): boolean {
    return this.nativeOnly || this.callbacks.renderer() === "dom";
  }

  canCapture(): boolean {
    return !this.nativeOnly && this.source.capabilities.canCapture();
  }

  hasVideo(): boolean {
    return this.source.capabilities.hasVideo();
  }

  private requestCanvasPresentation(native: boolean, primeNative: boolean) {
    if (this.source.isNative()) {
      if (this.live && !this.captureAbort && native) return;
      this.freezePending = this.source.freeze() || this.freezePending;
    }
    if (!this.canvasPaintRequested(native ? primeNative : undefined)) return;
    this.prepareContent();
    if (typeof this.canvas.requestPaint === "function")
      this.canvas.requestPaint();
  }

  private prepareContent(): boolean {
    return this.source.prepare(
      !this.live || this.captureAbort !== null || this.nativeRequested(),
    );
  }

  private updateLiveState(): void {
    const live = !this.resizing && this.callbacks.canDraw();
    if (!this.live && live) this.freezePending = true;
    if (this.live && !live && this.callbacks.visible())
      this.freezePending = true;
    if (!live && this.content.dataset.onirigiriLive !== "false")
      this.content.dataset.onirigiriLive = "false";
    this.live = live;
  }

  setResizing(active: boolean): void {
    PaneCanvasSurface.resizeAll([this], active);
  }

  static resizeAll(
    surfaces: readonly PaneCanvasSurface[],
    active: boolean,
  ): void {
    const updates = surfaces
      .filter((surface) => surface.resizing !== active)
      .map((surface) => ({
        surface,
        apply: surface.presentation.prepare(active),
      }));
    for (const { surface, apply } of updates) {
      surface.resizing = active;
      apply?.();
    }
    for (const { surface } of updates) surface.requestPaint();
  }

  hasCurrentFrame(): boolean {
    return Boolean(
      this.lastImage &&
      this.imageRevision === this.callbacks.revision() &&
      this.imageSize?.width === this.content.offsetWidth &&
      this.imageSize.height === this.content.offsetHeight,
    );
  }

  get frameVersion(): number {
    return this.imageVersion;
  }

  clear(): void {
    if (!this.context || this.captureAbort || this.disposed) return;
    this.context.unconfigure();
    this.configure();
    this.canvas.width = this.canvas.height = 1;
    this.lastImage?.close();
    this.lastImage = null;
    this.imageSize = null;
    this.freezePending = false;
    this.callbacks.drawn(false);
  }

  dispose(): void {
    this.disposed = true;
    this.unwatchDeviceLoss?.();
    contentSurfaces.delete(this.content);
    const worker = pictureWorkers.get(this.content.ownerDocument);
    if (worker?.owners.delete(this) && worker.owners.size === 0) {
      worker.client.dispose();
      pictureWorkers.delete(this.content.ownerDocument);
    }
    this.captureAbort?.abort();
    this.source.dispose();
    this.canvas.clearElementGeometry?.(this.content);
    delete this.content.dataset.onirigiriLive;
    this.presentation.restore();
    this.lastImage?.close();
    this.lastImage = null;
    this.copyBudget.forget(this);
    this.resize.disconnect();
    this.canvas.removeEventListener("paint", this.paint);
    this.source.preserveScroll(() =>
      this.canvas.style.removeProperty("--_onirigiri-capture-scale"),
    );
    this.context?.unconfigure();
    this.context = null;
    this.device = null;
  }

  async capturePicture(
    signal: AbortSignal,
    recorded?: () => void,
  ): Promise<{
    image: Blob;
    cssSize: { width: number; height: number };
  } | null> {
    signal.throwIfAborted();
    if (!this.initialized || this.nativeOnly || this.disposed) return null;
    const cssSize = {
      width: this.content.offsetWidth,
      height: this.content.offsetHeight,
    };
    const document = this.content.ownerDocument;
    const worker = pictureWorkerFor(document);
    worker.owners.add(this);
    if (worker.active) return null;
    worker.active = true;
    try {
      if (!(await worker.client.prepare(signal))) return null;
      const result = await this.capture({
        signal,
        stage: !this.callbacks.visible(),
        recorded,
        maxRasterBytes: 128 * 1024 * 1024,
        maxEncodedBytes: 32 * 1024 * 1024,
        background: {
          client: worker.client,
          id: "consumer-picture",
          required: true,
        },
      });
      if (
        this.disposed ||
        this.content.offsetWidth !== cssSize.width ||
        this.content.offsetHeight !== cssSize.height
      )
        return null;
      return { image: result.image, cssSize };
    } finally {
      worker.active = false;
    }
  }

  async capture(request: PaneCanvasSnapshotRequest): Promise<{
    image: Blob;
    width: number;
    height: number;
  }> {
    request.signal.throwIfAborted();
    this.assertCapturable();
    const display = this.needsCaptureDisplay(request.stage)
      ? await preparePaneCaptureDisplay(this.device!, request.signal)
      : undefined;
    request.signal.throwIfAborted();
    this.assertCapturable();
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abort, { once: true });
    this.captureAbort = controller;
    let recorded = false;
    try {
      const preparation = this.prepareWorker(request, controller.signal);
      const worker = preparation ? await preparation : null;
      controller.signal.throwIfAborted();
      const size = this.rasterSize(request.maxRasterBytes, worker?.limit);
      const image = worker
        ? await this.captureInWorker(
            worker.canvas,
            request.background!,
            size,
            controller.signal,
            () => {
              recorded = true;
              request.signal.removeEventListener("abort", abort);
              if (this.captureAbort === controller) this.captureAbort = null;
              this.requestPaint();
              request.recorded?.();
            },
          )
        : await this.captureOnMain(
            size,
            controller.signal,
            request.stage,
            display,
          );
      if (!recorded) controller.signal.throwIfAborted();
      if (image.size > request.maxEncodedBytes)
        throw new Error("Pane canvas exceeds the encoded picture budget");
      return { image, ...size };
    } finally {
      request.signal.removeEventListener("abort", abort);
      if (request.stage) this.releaseStagedImage();
      if (this.captureAbort === controller) this.captureAbort = null;
      this.requestPaint();
    }
  }

  private prepareWorker(
    request: PaneCanvasSnapshotRequest,
    signal: AbortSignal,
  ) {
    if (!request.stage || !request.background) return null;
    const { client, required } = request.background;
    return client.prepare(signal).then((worker) => {
      signal.throwIfAborted();
      if (!worker && required)
        throw new Error("Pane capture worker is unavailable");
      return worker;
    });
  }

  private async captureInWorker(
    canvas: HTMLCanvasElement,
    background: NonNullable<PaneCanvasSnapshotRequest["background"]>,
    size: { width: number; height: number },
    signal: AbortSignal,
    onRecorded: () => void,
  ): Promise<Blob> {
    await background.client.resize(size, signal);
    const restore = this.stageWorker(canvas);
    signal.addEventListener("abort", restore, { once: true });
    let recorded: ElementImage;
    try {
      await this.settleStage(signal);
      recorded = await this.recordWorkerImage(canvas as ElementCanvas, signal);
    } finally {
      signal.removeEventListener("abort", restore);
      restore();
    }
    try {
      onRecorded();
      return await background.client.capture(
        background.id,
        recorded,
        size,
        new AbortController().signal,
      );
    } finally {
      recorded.close();
    }
  }

  private async captureOnMain(
    size: { width: number; height: number },
    signal: AbortSignal,
    stage: boolean,
    display: GPURenderPipeline | undefined,
  ): Promise<Blob> {
    const texture = this.captureTexture(size);
    let restore: (() => void) | undefined;
    try {
      if (stage) {
        restore = this.stage();
        signal.addEventListener("abort", restore, { once: true });
      }
      await this.recordCapture(texture, signal, stage, display);
      if (restore) signal.removeEventListener("abort", restore);
      restore?.();
      return await readPaneCanvasTexture(this.device!, texture, signal);
    } finally {
      texture.destroy();
      if (restore) signal.removeEventListener("abort", restore);
      restore?.();
    }
  }

  private needsCaptureDisplay(stage: boolean): boolean {
    return this.live && !stage && !this.hasCurrentFrame();
  }

  private releaseStagedImage(): void {
    this.lastImage?.close();
    this.lastImage = null;
    this.imageSize = null;
  }

  private assertCapturable(): void {
    if (!this.device || !this.context || this.disposed)
      throw new Error("Pane canvas is not ready");
    if (this.captureAbort)
      throw new Error("Pane canvas capture is already active");
  }

  private async recordCapture(
    texture: GPUTexture,
    signal: AbortSignal,
    stage: boolean,
    display: GPURenderPipeline | undefined,
  ): Promise<void> {
    if (!stage && this.hasCurrentFrame()) {
      this.copyImage(this.lastImage!, texture, false);
      return;
    }
    if (stage) await this.settleStage(signal);
    await this.capturePaint(texture, signal, stage, display);
  }

  private settleStage(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const view = this.canvas.ownerDocument.defaultView!;
    return new Promise((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", abort);
      const abort = () => {
        view.cancelAnimationFrame(frame);
        cleanup();
        reject(signal.reason);
      };
      let frame = view.requestAnimationFrame(() => {
        frame = view.requestAnimationFrame(() => {
          cleanup();
          resolve();
        });
      });
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  private initialize = (device: GPUDevice): void => {
    if (this.disposed) return;
    this.device = device;
    this.context = this.canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!this.context) {
      this.failed(new Error("Onirigiri could not create a WebGPU canvas"));
      return;
    }
    this.configure();
    this.initialized = true;
    this.unwatchDeviceLoss = PaneCanvasSurface.watchDeviceLoss(
      device,
      new WeakRef(this),
    );
    this.requestPaint();
  };

  private static readonly deviceSurfaces = new WeakMap<
    GPUDevice,
    Set<WeakRef<PaneCanvasSurface>>
  >();

  // The device outlives every pane. A reaction created inside an instance method keeps that
  // instance, and its pane's content, alive through the method's scope even behind a WeakRef;
  // this static scope holds WeakRefs alone, behind one reaction per device.
  private static watchDeviceLoss(
    device: GPUDevice,
    surface: WeakRef<PaneCanvasSurface>,
  ): () => void {
    let surfaces = PaneCanvasSurface.deviceSurfaces.get(device);
    if (!surfaces) {
      const watched = new Set<WeakRef<PaneCanvasSurface>>();
      surfaces = watched;
      PaneCanvasSurface.deviceSurfaces.set(device, watched);
      void device.lost.then((info) => {
        for (const lost of watched) lost.deref()?.lost(info);
      });
    }
    surfaces.add(surface);
    return () => surfaces.delete(surface);
  }

  private captureUnavailable = (): void => {
    if (this.disposed) return;
    this.nativeOnly = true;
    this.initialized = true;
    this.requestPaint();
    this.callbacks.changed?.();
  };

  private lost(info: GPUDeviceLostInfo): void {
    if (this.disposed) return;
    const error = new Error(`Onirigiri WebGPU device lost: ${info.message}`);
    const capture = this.captureAbort;
    this.captureAbort = null;
    capture?.abort(error);
    this.context?.unconfigure();
    this.context = null;
    this.device = null;
    this.lastImage?.close();
    this.lastImage = null;
    this.imageSize = null;
    this.freezePending = false;
    this.copyBudget.forget(this);
    if (!this.source.isNative()) this.callbacks.drawn(false);
    this.captureUnavailable();
  }

  private configure(): void {
    this.context!.configure({
      device: this.device!,
      format: "rgba8unorm",
      alphaMode: "premultiplied",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private rasterSize(
    budget: number,
    limit = this.device!.limits.maxTextureDimension2D,
  ): { width: number; height: number } {
    return paneCanvasRasterSize(
      this.content.offsetWidth,
      this.content.offsetHeight,
      this.canvas.ownerDocument.defaultView!.devicePixelRatio,
      budget,
      Math.min(limit, this.device!.limits.maxTextureDimension2D),
    );
  }

  private paint = (event: Event): void => {
    if (!this.paintAllowed()) return;
    try {
      if (!this.updateTexture(event as ElementPaintEvent)) return;
    } catch (error) {
      this.failed(error);
      return;
    }
    if (!this.live) return;
    if (this.content.dataset.onirigiriLive !== "true")
      this.content.dataset.onirigiriLive = "true";
    this.canvas.requestPaint();
  };

  private updateTexture(event: ElementPaintEvent): boolean {
    const size = paneCanvasRasterSize(
      this.content.offsetWidth,
      this.content.offsetHeight,
      this.canvas.ownerDocument.defaultView!.devicePixelRatio *
        this.callbacks.displayScale(),
      128 * 1024 * 1024,
      this.device!.limits.maxTextureDimension2D,
    );
    const required = this.textureCopyRequired(size);
    const refresh =
      this.refreshPending || event.changedElements.includes(this.content);
    if (!required && !refresh) return true;
    if (!required && !this.copyBudget.request(this)) {
      this.refreshPending = true;
      return true;
    }
    return this.copyTextureFrame(size);
  }

  private textureCopyRequired(size: { height: number; width: number }) {
    return (
      this.canvas.width !== size.width ||
      this.canvas.height !== size.height ||
      this.freezePending ||
      !this.hasCurrentFrame()
    );
  }

  private copyTextureFrame(size: { height: number; width: number }): boolean {
    if (!this.recordElement(size)) return false;
    const started = performance.now();
    this.copyImage(this.lastImage!, this.context!.getCurrentTexture(), true);
    this.copyBudget.record(this, performance.now() - started);
    this.canvas.updateElementGeometry?.(this.content);
    this.refreshPending = false;
    this.presentation.painted();
    this.freezePending = false;
    this.callbacks.drawn(true, "canvas");
    return true;
  }

  private usesNativePresentation(native: boolean, primeNative: boolean) {
    return (
      !this.captureAbort &&
      native &&
      (this.live ||
        this.callbacks.continuous() ||
        this.source.isNative() ||
        !this.canCapture() ||
        !this.hasCurrentFrame() ||
        primeNative)
    );
  }

  private paintAllowed(): boolean {
    return Boolean(
      this.context &&
      !this.usesNativePresentation(
        this.nativeRequested(),
        this.canPrimeNative(),
      ) &&
      !this.source.isNative() &&
      !this.captureAbort &&
      ((this.freezePending && this.callbacks.visible()) ||
        (!this.resizing &&
          (this.callbacks.canDraw() || this.callbacks.canPrime()))),
    );
  }

  private copyElement(
    texture: GPUTexture,
    premultipliedAlpha: boolean,
  ): boolean {
    if (!this.recordElement(texture)) return false;
    this.copyImage(this.lastImage!, texture, premultipliedAlpha);
    return true;
  }

  private recordElement(size: { height: number; width: number }): boolean {
    if (this.prepareContent()) {
      this.requestPaint();
      return false;
    }
    if (this.canvas.width !== size.width) this.canvas.width = size.width;
    if (this.canvas.height !== size.height) this.canvas.height = size.height;
    const changed = !this.hasCurrentFrame() || this.freezePending;
    const image = this.recordImage(this.canvas);
    this.lastImage?.close();
    this.lastImage = image;
    if (!this.lastImage) {
      this.imageSize = null;
      return false;
    }
    if (changed) this.imageVersion++;
    this.imageSize = {
      width: this.content.offsetWidth,
      height: this.content.offsetHeight,
    };
    this.imageRevision = this.callbacks.revision();
    return true;
  }

  private recordImage(canvas: ElementCanvas): ElementImage | null {
    for (const frame of this.content.getElementsByTagName("iframe")) {
      if (!frame.contentDocument)
        throw new Error(
          "This pane contains a cross-origin iframe. Use content hosted on this origin or supply a pane picture.",
        );
    }
    const started = performance.now();
    const image = canvas.captureElementImage(this.content);
    performance.measure("onirigiri.capture.extraction", {
      start: started,
      end: performance.now(),
    });
    performance.clearMeasures("onirigiri.capture.extraction");
    const width =
      (this.content.offsetWidth * canvas.width) / canvas.offsetWidth;
    const imageWidth = elementImageWidth(canvas, image);
    if (Math.abs(imageWidth - width) <= 1) return image;
    this.recordingScale *= imageWidth / width;
    this.applyRecordingScale(canvas);
    image.close();
    if (canvas === this.canvas) this.requestPaint();
    else canvas.requestPaint();
    return null;
  }

  private applyRecordingScale(canvas: ElementCanvas = this.canvas): void {
    this.source.preserveScroll(() => {
      for (const target of new Set([this.canvas, canvas]))
        target.style.setProperty(
          "--_onirigiri-capture-scale",
          String(this.recordingScale),
        );
    });
  }

  private recordWorkerImage(
    canvas: ElementCanvas,
    signal: AbortSignal,
  ): Promise<ElementImage> {
    signal.throwIfAborted();
    return this.nextPaint(
      canvas,
      signal,
      () => this.recordImage(canvas),
      () => canvas.requestPaint(),
    );
  }

  private nextPaint<T>(
    canvas: ElementCanvas,
    signal: AbortSignal,
    record: () => T | null,
    request: () => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        canvas.removeEventListener("paint", paint);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const paint = () => {
        try {
          signal.throwIfAborted();
          const result = record();
          if (result === null) return;
          cleanup();
          resolve(result);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      canvas.addEventListener("paint", paint);
      signal.addEventListener("abort", abort, { once: true });
      request();
    });
  }

  private copyImage(
    image: ElementImage,
    texture: GPUTexture,
    premultipliedAlpha: boolean,
  ): void {
    drawElementImage(this.device!.queue, image, texture, premultipliedAlpha);
  }

  private captureTexture(size: { width: number; height: number }): GPUTexture {
    return this.device!.createTexture({
      size: [size.width, size.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private capturePaint(
    texture: GPUTexture,
    signal: AbortSignal,
    staged: boolean,
    display: GPURenderPipeline | undefined,
  ): Promise<boolean> {
    return this.nextPaint(
      this.canvas,
      signal,
      () => {
        if (!this.copyElement(texture, false)) return null;
        if (this.live && !staged) this.displayCapture(texture, display);
        return true;
      },
      () => this.requestPaint(),
    );
  }

  private displayCapture(
    texture: GPUTexture,
    display: GPURenderPipeline | undefined,
  ): void {
    const size = this.rasterSize(128 * 1024 * 1024);
    if (this.canvas.width !== size.width) this.canvas.width = size.width;
    if (this.canvas.height !== size.height) this.canvas.height = size.height;
    const destination = this.context!.getCurrentTexture();
    if (
      display &&
      texture.width === destination.width &&
      texture.height === destination.height
    )
      displayPaneCapture(this.device!, display, texture, destination);
    else this.copyImage(this.lastImage!, destination, true);
    this.canvas.updateElementGeometry?.(this.content);
    this.presentation.painted();
    this.freezePending = false;
    this.callbacks.drawn(true);
  }

  private stage(): () => void {
    return stagePaneCanvas(
      this.canvas,
      (update) => this.source.preserveScroll(update),
      () => this.recordingScale,
      () => {
        this.context!.unconfigure();
        this.configure();
        this.callbacks.drawn(false);
      },
    );
  }

  private stageWorker(canvas: HTMLCanvasElement): () => void {
    const size = {
      width: this.canvas.offsetWidth,
      height: this.canvas.offsetHeight,
    };
    this.freezePending = this.source.freeze() || this.freezePending;
    let restoreStage: (() => void) | undefined;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      this.source.preserveScroll(() => {
        this.canvas.moveBefore(this.content, null);
        restoreStage?.();
        canvas.remove();
      });
    };
    try {
      this.source.preserveScroll(() => {
        this.prepareContent();
        canvas.className = this.canvas.className;
        canvas.style.cssText = this.canvas.style.cssText;
        markElementCanvas(canvas);
        canvas.setAttribute("data-onirigiri-recording", "");
        this.canvas.after(canvas);
        canvas.moveBefore(this.content, null);
        restoreStage = stagePaneCanvas(
          canvas,
          (update) => update(),
          () => this.recordingScale,
          () => this.callbacks.drawn(false),
          size,
        );
      });
      return restore;
    } catch (error) {
      restore();
      throw error;
    }
  }

  private failed = (error: unknown): void => {
    this.callbacks.drawn(false);
    this.callbacks.failed(
      error instanceof Error
        ? error
        : new Error("Pane canvas rendering failed"),
    );
    if (this.initialized && this.live && !this.captureAbort && !this.disposed)
      this.source.present();
  };
}
