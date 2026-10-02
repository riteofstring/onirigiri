import {
  PaneContentCapabilities,
  paneVideoSurfaces,
} from "../panes/pane-content-capabilities.js";

interface PanePictureContentCallbacks {
  canPresent: () => boolean;
  changed: () => void;
  interactive: () => boolean;
  presented: () => void;
}

export class PanePictureContent {
  readonly capabilities: PaneContentCapabilities;
  private readonly scrollbarStyles = new Map<Document, HTMLStyleElement>();
  private readonly host: HTMLDivElement;
  private frame: number | null = null;
  private native = false;
  private readonly videos = new Map<HTMLVideoElement, PaneVideoSurface>();
  private readonly watchedVideos = new Set<HTMLVideoElement>();
  private videosActive = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly content: HTMLElement,
    private readonly callbacks: PanePictureContentCallbacks,
  ) {
    this.capabilities = new PaneContentCapabilities(content, callbacks.changed);
    this.host = canvas.ownerDocument.createElement("div");
    this.host.className = "onirigiri-pane__native-surface";
    this.host.hidden = true;
  }

  isNative(): boolean {
    return this.native;
  }

  present(): void {
    if (this.native || this.frame !== null) return;
    this.frame = this.canvas.ownerDocument.defaultView!.requestAnimationFrame(
      () => {
        this.frame = null;
        if (!this.callbacks.canPresent()) return;
        this.host.style.setProperty(
          "--_onirigiri-capture-scale",
          this.canvas.style.getPropertyValue("--_onirigiri-capture-scale"),
        );
        this.canvas.before(this.host);
        this.host.hidden = false;
        this.preserveScroll(() => moveInto(this.host, this.content));
        this.native = true;
        this.canvas.dataset.onirigiriNativeActive = "true";
        this.content.dataset.onirigiriLive = "true";
        this.callbacks.presented();
      },
    );
  }

  presentVideos(active: boolean): void {
    this.videosActive = active;
    this.syncVideos();
  }

  private syncVideos = (): void => {
    const candidates = new Set(
      this.videosActive ? this.capabilities.videoElements() : [],
    );
    this.watchVideos(candidates);
    const interactive = this.callbacks.interactive();
    this.syncVideoSurfaces(
      new Set(
        [...candidates].filter((video) => !interactive || !videoEngaged(video)),
      ),
    );
  };

  private watchVideos(candidates: ReadonlySet<HTMLVideoElement>): void {
    for (const video of this.watchedVideos) {
      if (candidates.has(video)) continue;
      for (const event of videoEngagementEvents)
        video.removeEventListener(event, this.syncVideos);
      this.watchedVideos.delete(video);
    }
    for (const video of candidates) {
      if (this.watchedVideos.has(video)) continue;
      for (const event of videoEngagementEvents)
        video.addEventListener(event, this.syncVideos);
      this.watchedVideos.add(video);
    }
  }

  private syncVideoSurfaces(videos: ReadonlySet<HTMLVideoElement>): void {
    for (const [video, surface] of this.videos) {
      if (videos.has(video)) continue;
      surface.dispose();
      this.videos.delete(video);
    }
    for (const video of videos) {
      if (!this.videos.has(video)) {
        const surface = PaneVideoSurface.create(video);
        if (surface) this.videos.set(video, surface);
      }
    }
  }

  freeze(): boolean {
    this.presentVideos(false);
    if (this.frame !== null)
      this.canvas.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!this.native) return false;
    this.preserveScroll(() => moveInto(this.canvas, this.content));
    this.native = false;
    this.host.hidden = true;
    delete this.canvas.dataset.onirigiriNativeActive;
    this.content.dataset.onirigiriLive = "false";
    return true;
  }

  prepare(recording: boolean): boolean {
    const changed =
      this.canvas.hasAttribute("data-onirigiri-recording") !== recording;
    this.canvas.toggleAttribute("data-onirigiri-recording", recording);
    this.host.toggleAttribute("data-onirigiri-recording", recording);
    if (!recording) {
      this.restoreScrollbars();
      return changed;
    }
    const documents = this.capabilities.iframeDocuments();
    let documentsChanged = false;
    for (const document of documents) {
      if (this.scrollbarStyles.get(document)?.isConnected) continue;
      const style = document.createElement("style");
      style.textContent =
        "* { scrollbar-color: transparent transparent !important; }";
      (document.head ?? document.documentElement).append(style);
      this.scrollbarStyles.set(document, style);
      documentsChanged = true;
    }
    for (const [document, style] of this.scrollbarStyles) {
      if (documents.has(document)) continue;
      style.remove();
      this.scrollbarStyles.delete(document);
    }
    return changed || documentsChanged;
  }

  dispose(): void {
    this.capabilities.dispose();
    this.freeze();
    this.restoreScrollbars();
    this.canvas.removeAttribute("data-onirigiri-recording");
    this.host.remove();
  }

  preserveScroll(update: () => void): void {
    const offsets = [this.content, ...this.content.querySelectorAll("*")]
      .filter((element) => element.scrollLeft !== 0 || element.scrollTop !== 0)
      .map((element) => ({
        element,
        left: element.scrollLeft,
        top: element.scrollTop,
      }));
    update();
    for (const { element, left, top } of offsets) {
      element.scrollTo({ left, top, behavior: "instant" });
    }
  }

  private restoreScrollbars(): void {
    for (const style of this.scrollbarStyles.values()) style.remove();
    this.scrollbarStyles.clear();
  }
}

class PaneVideoSurface {
  private static sequence = 0;
  private readonly host: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly token = `onirigiri-video-${++PaneVideoSurface.sequence}`;
  private readonly sheet: CSSStyleSheet;
  private frame: number | null = null;
  private disposed = false;
  private readonly observer: MutationObserver;

  static create(video: HTMLVideoElement): PaneVideoSurface | null {
    const view = video.ownerDocument.defaultView;
    if (!view || !videoPresentationSupported(video, view)) return null;
    if (!videoContainerSupported(video, view) || !videoMediaSupported(video))
      return null;
    const style = view.getComputedStyle(video);
    if (!videoStyleSupported(video, style)) return null;
    const canvas = video.ownerDocument.createElement("canvas");
    const context = canvas.getContext("2d");
    return context ? new PaneVideoSurface(video, canvas, context, style) : null;
  }

  private constructor(
    private readonly video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    style: CSSStyleDeclaration,
  ) {
    this.canvas = canvas;
    this.context = context;
    const document = video.ownerDocument;
    const bounds = JSON.stringify(video.getBoundingClientRect());
    const properties = [
      "object-fit",
      "object-position",
      "display",
      "visibility",
      "padding",
      "border",
      "border-radius",
      "background",
      "box-shadow",
      "transform",
      "opacity",
    ];
    const appearance = properties.map((property) =>
      style.getPropertyValue(property),
    );
    const host = (this.host = document.createElement("div"));
    paneVideoSurfaces.add(host);
    host.setAttribute("aria-hidden", "true");
    host.dataset.onirigiriVideoSurface = "true";
    host.style.cssText =
      "all:initial;position:absolute;pointer-events:none;box-sizing:border-box;margin:0;display:block;visibility:hidden;overflow:hidden;";
    host.style.setProperty("position-anchor", `--${this.token}`);
    host.style.setProperty("position-visibility", "anchors-valid");
    host.style.left = "anchor(left)";
    host.style.top = "anchor(top)";
    host.style.width = "anchor-size(width)";
    host.style.height = "anchor-size(height)";
    for (const property of [
      "border-radius",
      "padding",
      "border-top",
      "border-right",
      "border-bottom",
      "border-left",
      "background",
      "box-shadow",
      "z-index",
    ])
      host.style.setProperty(property, style.getPropertyValue(property));
    canvas.style.cssText = "display:block;width:100%;height:100%;";
    canvas.style.objectFit = style.objectFit;
    canvas.style.objectPosition = style.objectPosition;
    canvas.style.imageRendering = style.imageRendering;
    host.attachShadow({ mode: "closed" }).append(canvas);
    this.sheet = new document.defaultView!.CSSStyleSheet();
    const anchor =
      style.anchorName === "none"
        ? `--${this.token}`
        : `${style.anchorName}, --${this.token}`;
    this.sheet.replaceSync(
      `video[data-onirigiri-video-presenter="${this.token}"] { anchor-name: ${anchor} !important; } video[data-onirigiri-video-presenter="${this.token}"][data-onirigiri-video-renderer="canvas"] { opacity: 0 !important; }`,
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
    video.dataset.onirigiriVideoPresenter = this.token;
    video.after(host);
    this.observer = new MutationObserver(this.dispose);
    this.observer.observe(video, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
    for (const event of ["loadeddata", "seeked", "resize"])
      video.addEventListener(event, this.draw);
    for (const event of ["emptied", "encrypted", "enterpictureinpicture"])
      video.addEventListener(event, this.dispose);
    video.textTracks.addEventListener("change", this.checkTracks);
    document.addEventListener("fullscreenchange", this.checkFullscreen);
    const currentStyle = document.defaultView!.getComputedStyle(video);
    if (
      JSON.stringify(video.getBoundingClientRect()) !== bounds ||
      JSON.stringify(host.getBoundingClientRect()) !== bounds ||
      properties.some(
        (property, index) =>
          currentStyle.getPropertyValue(property) !== appearance[index],
      )
    ) {
      this.dispose();
      return;
    }
    this.draw();
    if (!this.disposed)
      this.frame = video.requestVideoFrameCallback(this.advance);
  }

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    if (this.frame !== null) this.video.cancelVideoFrameCallback(this.frame);
    this.frame = null;
    for (const event of ["loadeddata", "seeked", "resize"])
      this.video.removeEventListener(event, this.draw);
    for (const event of ["emptied", "encrypted", "enterpictureinpicture"])
      this.video.removeEventListener(event, this.dispose);
    this.video.textTracks.removeEventListener("change", this.checkTracks);
    const document = this.video.ownerDocument;
    document.removeEventListener("fullscreenchange", this.checkFullscreen);
    delete this.video.dataset.onirigiriVideoRenderer;
    delete this.video.dataset.onirigiriVideoPresenter;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== this.sheet,
    );
    this.host.remove();
    this.canvas.width = this.canvas.height = 1;
  };

  private checkTracks = (): void => {
    if ([...this.video.textTracks].some((track) => track.mode === "showing"))
      this.dispose();
  };

  private checkFullscreen = (): void => {
    if (this.video.ownerDocument.fullscreenElement === this.video)
      this.dispose();
  };

  private draw = (): void => {
    if (this.disposed) return;
    const video = this.video;
    if (!this.sourceValid()) {
      this.dispose();
      return;
    }
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    try {
      this.copyVideoFrame();
      if (video.dataset.onirigiriVideoRenderer !== "canvas") {
        this.host.style.visibility = "visible";
        video.dataset.onirigiriVideoRenderer = "canvas";
      }
    } catch {
      this.dispose();
    }
  };

  private sourceValid(): boolean {
    return (
      this.video.isConnected &&
      this.video.parentElement === this.host.parentElement &&
      videoMediaSupported(this.video)
    );
  }

  private copyVideoFrame(): void {
    const video = this.video;
    if (this.canvas.width !== video.videoWidth)
      this.canvas.width = video.videoWidth;
    if (this.canvas.height !== video.videoHeight)
      this.canvas.height = video.videoHeight;
    this.context.globalCompositeOperation = "copy";
    this.context.drawImage(video, 0, 0);
  }

  private advance = (): void => {
    this.frame = null;
    this.draw();
    if (!this.disposed)
      this.frame = this.video.requestVideoFrameCallback(this.advance);
  };
}

function moveInto(parent: Element, child: Element): void {
  if (typeof parent.moveBefore === "function") parent.moveBefore(child, null);
  else parent.append(child);
}

const videoEngagementEvents = [
  "play",
  "pause",
  "ended",
  "pointerenter",
  "pointerleave",
  "focus",
  "blur",
] as const;

function videoEngaged(video: HTMLVideoElement): boolean {
  return (
    video.controls &&
    (video.paused ||
      video.matches(":hover") ||
      video.ownerDocument.activeElement === video)
  );
}

function videoPresentationSupported(
  video: HTMLVideoElement,
  view: NonNullable<Document["defaultView"]>,
): boolean {
  const anchors = [
    ["left", "anchor(left)"],
    ["width", "anchor-size(width)"],
  ] as const;
  return (
    anchors.every(([property, value]) =>
      view.CSS?.supports?.(property, value),
    ) &&
    typeof video.requestVideoFrameCallback === "function" &&
    !video.hasAttribute("data-onirigiri-video-presenter") &&
    !video.style.getPropertyPriority("opacity") &&
    !video.style.getPropertyPriority("anchor-name")
  );
}

function videoContainerSupported(
  video: HTMLVideoElement,
  view: NonNullable<Document["defaultView"]>,
): boolean {
  const containingBlock = video.offsetParent;
  if (!video.isConnected || !video.parentElement || !containingBlock)
    return false;
  for (
    let element: Element | null = video.parentElement;
    element && element !== containingBlock;
    element = element.parentElement
  ) {
    if (styleClipsDescendants(view.getComputedStyle(element))) return false;
  }
  return true;
}

function styleClipsDescendants(style: CSSStyleDeclaration): boolean {
  return (
    style.overflowX !== "visible" ||
    style.overflowY !== "visible" ||
    style.clipPath !== "none" ||
    style.maskImage !== "none" ||
    /paint|strict|content/.test(style.contain)
  );
}

function videoMediaSupported(video: HTMLVideoElement): boolean {
  return (
    !video.mediaKeys &&
    video.ownerDocument.pictureInPictureElement !== video &&
    video.ownerDocument.fullscreenElement !== video &&
    ![...video.textTracks].some((track) => track.mode === "showing")
  );
}

function videoStyleSupported(
  video: HTMLVideoElement,
  style: CSSStyleDeclaration,
): boolean {
  const effects = [
    "transform",
    "translate",
    "rotate",
    "scale",
    "filter",
    "clip-path",
    "mask-image",
    "outline-style",
    "border-image-source",
    "backdrop-filter",
  ];
  const appearance = {
    "mix-blend-mode": "normal",
    opacity: "1",
    visibility: "visible",
    clip: "auto",
  };
  return (
    effects.every((property) => style.getPropertyValue(property) === "none") &&
    Object.entries(appearance).every(
      ([property, value]) => style.getPropertyValue(property) === value,
    ) &&
    style.display !== "none" &&
    !["fixed", "sticky"].includes(style.position) &&
    !style.transitionDuration
      .split(",")
      .some((duration) => parseFloat(duration) > 0) &&
    video.getAnimations().length === 0
  );
}
