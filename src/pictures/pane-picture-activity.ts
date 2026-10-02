const activityEvents = [
  "keydown",
  "pointerdown",
  "pointerup",
  "pointercancel",
  "wheel",
  "resize",
  "scroll",
  "visibilitychange",
  "blur",
] as const;

export class PanePictureActivity {
  private readonly pointers = new Set<number>();
  private quietUntil = 0;
  private preloadQuietUntil = 0;
  private readonly resizePointers = new Set<number>();

  constructor(
    private readonly changed: (presentationChanged: boolean) => void,
  ) {}

  idle(): boolean {
    return this.pointers.size === 0 && Date.now() >= this.quietUntil;
  }

  canPreload(): boolean {
    return this.pointers.size === 0 && Date.now() >= this.preloadQuietUntil;
  }

  resizing(): boolean {
    return this.resizePointers.size > 0;
  }

  start(document: Document): () => void {
    const view = document.defaultView;
    for (const event of activityEvents)
      view?.addEventListener(event, this.handle, true);
    return () => {
      for (const event of activityEvents)
        view?.removeEventListener(event, this.handle, true);
      this.pointers.clear();
      this.resizePointers.clear();
      this.quietUntil = 0;
      this.preloadQuietUntil = 0;
    };
  }

  private recordPointer(event: Event): void {
    const id = (event as PointerEvent).pointerId;
    if (event.type === "pointerdown") {
      this.pointers.add(id);
      if (isPaneResizeTarget(event.target)) this.resizePointers.add(id);
    } else if (["pointerup", "pointercancel"].includes(event.type)) {
      this.pointers.delete(id);
      this.resizePointers.delete(id);
    } else if (["blur", "visibilitychange"].includes(event.type)) {
      this.pointers.clear();
      this.resizePointers.clear();
    }
  }

  private handle = (event: Event): void => {
    const resizing = this.resizing();
    this.recordPointer(event);
    this.quietUntil = Date.now() + 200;
    const global = ["resize", "blur", "visibilitychange"].includes(event.type);
    if (global) this.preloadQuietUntil = this.quietUntil;
    this.changed(global || resizing !== this.resizing());
  };
}

function isPaneResizeTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      '[data-onirigiri-slot="pane-resize-column"], [data-onirigiri-slot="pane-resize-row"]',
    )
  );
}
