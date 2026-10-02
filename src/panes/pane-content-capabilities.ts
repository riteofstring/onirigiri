export const paneVideoSurfaces = new WeakSet<Element>();

export class PaneContentCapabilities {
  private readonly observers = new Map<Element, MutationObserver>();
  private readonly frames = new Set<HTMLIFrameElement>();
  private dirty = true;
  private video = false;
  private videos: HTMLVideoElement[] = [];
  private capturable = true;
  private documents = new Set<Document>();

  constructor(
    private readonly content: HTMLElement,
    private readonly changed: () => void,
  ) {}

  hasVideo(): boolean {
    this.refresh();
    return this.video;
  }

  videoElements(): readonly HTMLVideoElement[] {
    this.refresh();
    return this.videos;
  }

  canCapture(): boolean {
    this.refresh();
    return (
      this.capturable &&
      !this.videos.some(
        (video) => video.mediaKeys !== null && video.mediaKeys !== undefined,
      )
    );
  }

  iframeDocuments(): ReadonlySet<Document> {
    this.refresh();
    return this.documents;
  }

  dispose(): void {
    for (const observer of this.observers.values()) observer.disconnect();
    for (const frame of this.frames)
      frame.removeEventListener("load", this.invalidate);
    this.observers.clear();
    this.frames.clear();
    this.documents.clear();
  }

  private invalidate = (): void => {
    this.dirty = true;
    this.changed();
  };

  private mutations = (records: MutationRecord[]): void => {
    if (records.some((record) => this.affectsCapabilities(record)))
      this.invalidate();
  };

  private affectsCapabilities(record: MutationRecord): boolean {
    return [...record.addedNodes, ...record.removedNodes].some((node) => {
      if (node.nodeType !== 1 || paneVideoSurfaces.has(node as Element))
        return false;
      return [node as Element, ...(node as Element).querySelectorAll("*")].some(
        (element) =>
          element.matches("canvas, video, iframe, object, embed") ||
          element.localName.includes("-") ||
          element.shadowRoot,
      );
    });
  }

  private refresh(): void {
    for (const observer of this.observers.values())
      if (
        observer
          .takeRecords()
          .some((record) => this.affectsCapabilities(record))
      )
        this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    const roots = new Set<Element>();
    const frames = new Set<HTMLIFrameElement>();
    const documents = new Set<Document>();
    let video = false;
    const videos: HTMLVideoElement[] = [];
    let capturable = true;
    const visit = (root: Element): void => {
      if (roots.has(root)) return;
      roots.add(root);
      for (const element of [root, ...root.querySelectorAll("*")]) {
        if (paneVideoSurfaces.has(element)) continue;
        if (element.localName === "video") {
          video = true;
          videos.push(element as HTMLVideoElement);
        }
        if (excludesElementCapture(element)) {
          capturable = false;
        }
        if (element.localName !== "iframe") continue;
        const frame = element as HTMLIFrameElement;
        frames.add(frame);
        const document = frame.contentDocument;
        if (!document?.documentElement) {
          capturable = false;
        } else {
          documents.add(document);
          visit(document.documentElement);
        }
      }
    };
    visit(this.content);
    this.synchronizeObservers(roots, frames);
    this.documents = documents;
    this.video = video;
    this.videos = videos;
    this.capturable = capturable;
  }
  private synchronizeObservers(
    roots: ReadonlySet<Element>,
    frames: ReadonlySet<HTMLIFrameElement>,
  ): void {
    for (const root of roots) {
      if (this.observers.has(root)) continue;
      const observer = new MutationObserver(this.mutations);
      observer.observe(root, { childList: true, subtree: true });
      this.observers.set(root, observer);
    }
    for (const [root, observer] of this.observers) {
      if (roots.has(root)) continue;
      observer.disconnect();
      this.observers.delete(root);
    }
    this.synchronizeFrames(frames);
  }

  private synchronizeFrames(frames: ReadonlySet<HTMLIFrameElement>): void {
    for (const frame of this.frames)
      if (!frames.has(frame))
        frame.removeEventListener("load", this.invalidate);
    for (const frame of frames)
      if (!this.frames.has(frame))
        frame.addEventListener("load", this.invalidate);
    this.frames.clear();
    for (const frame of frames) this.frames.add(frame);
  }
}

function excludesElementCapture(element: Element): boolean {
  return Boolean(
    element.matches("canvas, object, embed") ||
    element.localName.includes("-") ||
    element.shadowRoot,
  );
}
