import {
  paneCanvasRasterSize,
  readPaneCanvasTexture,
} from "./pane-picture-canvas-readback";
import { PanePictureResize } from "./pane-picture-resize";
import { PanePictureContent } from "./pane-picture-content";
import {
  documentLiveCopyBudget,
  type LiveCopyBudget,
} from "./pane-live-copy-budget";
import type { PaneLiveRenderer } from "../presentation/pane-presentation-policy";

declare const GPUTextureUsage: {
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly TEXTURE_BINDING: number;
  readonly RENDER_ATTACHMENT: number;
};

interface ElementImage {
  readonly width: number;
  close(): void;
}

interface ElementCanvas extends HTMLCanvasElement {
  requestPaint(): void;
  captureElementImage(element: Element): ElementImage;
}

interface ElementPaintEvent extends Event {
  readonly changedElements: readonly Element[];
}

interface ElementQueue extends GPUQueue {
  copyElementImageToTexture(
    source: { source: ElementImage },
    destination: {
      destination: { texture: GPUTexture; premultipliedAlpha: boolean };
      width: number;
      height: number;
    },
  ): void;
}

interface PaneCanvasSnapshotRequest {
  signal: AbortSignal;
  stage: boolean;
  maxRasterBytes: number;
  maxEncodedBytes: number;
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
  hideScrollbars(): boolean;
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
  if (
    typeof (device.queue as ElementQueue).copyElementImageToTexture !==
    "function"
  ) {
    device.destroy();
    throw new Error(paneCanvasRequirement);
  }
  return device;
}

export class PaneCanvasSurface {
  private readonly canvas: ElementCanvas;
  private readonly resize: ResizeObserver;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private initialized = false;
  private captureAbort: AbortController | null = null;
  private disposed = false;
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
    this.copyBudget = documentLiveCopyBudget(canvas.ownerDocument);
    this.presentation = new PanePictureResize(canvas, content);
    this.source = new PanePictureContent(canvas, content, {
      canPresent: () =>
        !this.disposed &&
        this.initialized &&
        !this.resizing &&
        !this.captureAbort &&
        this.nativeRequested() &&
        callbacks.canDraw(),
      changed: () => {
        callbacks.changed?.();
        this.requestPaint();
      },
      interactive: () => callbacks.interactive?.() === true,
      presented: () => {
        this.presentation.restore();
        this.source.prepare(this.callbacks.hideScrollbars());
        this.source.presentVideos(this.callbacks.videoFrames?.() === true);
        callbacks.drawn(true, "dom");
      },
    });
    this.applyRecordingScale();
    canvas.setAttribute("layoutsubtree", "");
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
    const native =
      this.live || this.callbacks.continuous()
        ? this.nativeRequested()
        : undefined;
    this.updateVideoPresentation(native);
    this.updateFrozenScale();
    if (this.usesNativePresentation(native)) {
      this.requestNativePresentation();
      return;
    }
    if (!this.prepareCanvasPresentation(native)) return;
    if (!this.canvasPaintRequested()) return;
    this.prepareContent();
    if (typeof this.canvas.requestPaint === "function")
      this.canvas.requestPaint();
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

  private requestNativePresentation(): void {
    this.source.prepare(this.callbacks.hideScrollbars());
    if (this.live) {
      if (this.source.isNative()) {
        if (this.content.dataset.onirigiriLive !== "true")
          this.content.dataset.onirigiriLive = "true";
        this.callbacks.drawn(true, "dom");
      }
      this.source.present();
    }
  }

  private canvasPaintRequested(): boolean {
    return Boolean(
      this.live ||
      (this.freezePending && this.callbacks.visible()) ||
      this.captureAbort ||
      this.callbacks.canPrime(),
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

  private prepareCanvasPresentation(native?: boolean): boolean {
    if (!this.source.isNative()) return true;
    if (this.live && !this.captureAbort && (native ?? this.nativeRequested()))
      return false;
    this.freezePending = this.source.freeze() || this.freezePending;
    return true;
  }

  private prepareContent(): boolean {
    return this.source.prepare(
      !this.live ||
        this.captureAbort !== null ||
        this.nativeRequested() ||
        this.callbacks.hideScrollbars(),
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
    if (this.resizing === active) return;
    this.resizing = active;
    this.presentation.set(active);
    this.requestPaint();
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
    this.source.dispose();
    delete this.content.dataset.onirigiriLive;
    this.presentation.restore();
    this.lastImage?.close();
    this.lastImage = null;
    this.copyBudget.forget(this);
    this.captureAbort?.abort();
    this.resize.disconnect();
    this.canvas.removeEventListener("paint", this.paint);
    this.source.preserveScroll(() =>
      this.canvas.style.removeProperty("--_onirigiri-capture-scale"),
    );
    this.context?.unconfigure();
    this.context = null;
    this.device = null;
  }

  async capture(request: PaneCanvasSnapshotRequest): Promise<{
    image: Blob;
    width: number;
    height: number;
  }> {
    request.signal.throwIfAborted();
    this.assertCapturable();
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abort, { once: true });
    this.captureAbort = controller;
    let restore: (() => void) | undefined;
    let texture: GPUTexture | undefined;
    try {
      const size = this.rasterSize(request.maxRasterBytes);
      texture = this.captureTexture(size);
      if (request.stage) restore = this.stage();
      await this.recordCapture(texture, controller.signal, request.stage);
      const image = await readPaneCanvasTexture(
        this.device!,
        texture,
        controller.signal,
      );
      if (image.size > request.maxEncodedBytes)
        throw new Error("Pane canvas exceeds the encoded picture budget");
      return { image, ...size };
    } finally {
      request.signal.removeEventListener("abort", abort);
      texture?.destroy();
      restore?.();
      if (request.stage) {
        this.lastImage?.close();
        this.lastImage = null;
        this.imageSize = null;
      }
      this.captureAbort = null;
      this.requestPaint();
    }
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
  ): Promise<void> {
    if (!stage && this.hasCurrentFrame()) {
      this.copyImage(this.lastImage!, texture, false);
      return;
    }
    if (stage) await this.settleStage(signal);
    await this.capturePaint(texture, signal, stage);
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
    const surface = new WeakRef(this);
    void device.lost.then((info) => surface.deref()?.lost(info));
    this.requestPaint();
  };

  private captureUnavailable = (): void => {
    if (this.disposed) return;
    this.nativeOnly = true;
    this.initialized = true;
    this.requestPaint();
  };

  private lost(info: GPUDeviceLostInfo): void {
    if (this.disposed) return;
    const error = new Error(`Onirigiri WebGPU device lost: ${info.message}`);
    this.captureAbort?.abort(error);
    this.context?.unconfigure();
    this.context = null;
    this.device = null;
    this.failed(error);
  }

  private configure(): void {
    this.context!.configure({
      device: this.device!,
      format: "rgba8unorm",
      alphaMode: "premultiplied",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private rasterSize(budget: number): { width: number; height: number } {
    return paneCanvasRasterSize(
      this.content.offsetWidth,
      this.content.offsetHeight,
      this.canvas.ownerDocument.defaultView!.devicePixelRatio,
      budget,
      this.device!.limits.maxTextureDimension2D,
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
    if (!this.recordElement()) return false;
    if (this.canvas.width !== size.width) this.canvas.width = size.width;
    if (this.canvas.height !== size.height) this.canvas.height = size.height;
    const started = performance.now();
    this.copyImage(this.lastImage!, this.context!.getCurrentTexture(), true);
    this.copyBudget.record(this, performance.now() - started);
    this.refreshPending = false;
    this.presentation.painted();
    this.freezePending = false;
    this.callbacks.drawn(true, "canvas");
    return true;
  }

  private usesNativePresentation(native?: boolean): boolean {
    return (
      (this.live ||
        this.callbacks.continuous() ||
        this.source.isNative() ||
        !this.canCapture()) &&
      (native ?? this.nativeRequested()) &&
      !this.captureAbort
    );
  }

  private paintAllowed(): boolean {
    return Boolean(
      this.context &&
      !this.usesNativePresentation() &&
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
    if (!this.recordElement()) return false;
    this.copyImage(this.lastImage!, texture, premultipliedAlpha);
    return true;
  }

  private recordElement(): boolean {
    if (this.prepareContent()) {
      this.requestPaint();
      return false;
    }
    for (const frame of this.content.getElementsByTagName("iframe")) {
      if (!frame.contentDocument)
        throw new Error(
          "This pane contains a cross-origin iframe. Use content hosted on this origin or supply a pane picture.",
        );
    }
    const changed = !this.hasCurrentFrame() || this.freezePending;
    this.lastImage?.close();
    this.lastImage = this.canvas.captureElementImage(this.content);
    const width = this.content.offsetWidth;
    if (Math.abs(this.lastImage.width - width) > 1) {
      this.recordingScale *= this.lastImage.width / width;
      this.applyRecordingScale();
      this.lastImage.close();
      this.lastImage = null;
      this.imageSize = null;
      this.requestPaint();
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

  private applyRecordingScale(): void {
    this.source.preserveScroll(() => {
      this.canvas.style.setProperty(
        "--_onirigiri-capture-scale",
        String(this.recordingScale),
      );
    });
  }

  private copyImage(
    image: ElementImage,
    texture: GPUTexture,
    premultipliedAlpha: boolean,
  ): void {
    (this.device!.queue as ElementQueue).copyElementImageToTexture(
      { source: image },
      {
        destination: { texture, premultipliedAlpha },
        width: texture.width,
        height: texture.height,
      },
    );
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
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.canvas.removeEventListener("paint", paint);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const paint = () => {
        try {
          signal.throwIfAborted();
          if (!this.copyElement(texture, false)) return;
          if (this.live && !staged) {
            const size = this.rasterSize(128 * 1024 * 1024);
            if (this.canvas.width !== size.width)
              this.canvas.width = size.width;
            if (this.canvas.height !== size.height)
              this.canvas.height = size.height;
            this.copyImage(
              this.lastImage!,
              this.context!.getCurrentTexture(),
              true,
            );
            this.presentation.painted();
            this.freezePending = false;
            this.callbacks.drawn(true);
          }
          cleanup();
          resolve();
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      this.canvas.addEventListener("paint", paint);
      signal.addEventListener("abort", abort, { once: true });
      this.requestPaint();
    });
  }

  private stage(): () => void {
    const canvas = this.canvas;
    const style = canvas.getAttribute("style");
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    const view = canvas.ownerDocument.defaultView!;
    const scale = Math.min(
      1,
      view.innerWidth / width,
      view.innerHeight / height,
    );
    const inert = canvas.inert;
    const restore = () =>
      this.source.preserveScroll(() => {
        if (canvas.matches(":popover-open")) canvas.hidePopover();
        canvas.removeAttribute("popover");
        if (style === null) canvas.removeAttribute("style");
        else canvas.setAttribute("style", style);
        canvas.style.setProperty(
          "--_onirigiri-capture-scale",
          String(this.recordingScale),
        );
        canvas.inert = inert;
      });
    try {
      this.context!.unconfigure();
      this.configure();
      this.callbacks.drawn(false);
      canvas.inert = true;
      canvas.setAttribute("popover", "manual");
      Object.assign(canvas.style, {
        position: "fixed",
        left: "0",
        top: "0",
        right: "auto",
        bottom: "auto",
        width: `${width}px`,
        height: `${height}px`,
        margin: "0",
        padding: "0",
        border: "0",
        background: "transparent",
        opacity: "1",
        pointerEvents: "none",
        transformOrigin: "0 0",
        transform: `scale(${scale})`,
      });
      canvas.showPopover();
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
