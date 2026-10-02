type SavedSize = readonly [HTMLElement, string, string, string, string];

export class PanePictureResize {
  private saved: SavedSize[] = [];
  private active = false;
  private source: SavedSize | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly content: HTMLElement,
  ) {}

  set(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      if (this.saved.length) return;
      const picture = this.canvas.parentElement?.querySelector<HTMLElement>(
        ".onirigiri-pane__picture-surface",
      );
      for (const element of [this.canvas, picture]) {
        if (!element) continue;
        this.saved.push(saveSize(element));
        element.style.width = `${element.offsetWidth}px`;
        element.style.height = `${element.offsetHeight}px`;
      }
    } else if (this.saved.length) {
      this.source ??= saveSize(this.content);
      const parent = this.canvas.parentElement!;
      this.content.style.width = `${parent.clientWidth}px`;
      this.content.style.height = `${parent.clientHeight}px`;
    }
  }

  painted(): void {
    if (!this.active) this.restore();
  }

  restore(): void {
    for (const size of this.saved) restoreSize(size);
    if (this.source) restoreSize(this.source);
    this.saved = [];
    this.source = null;
    this.active = false;
  }
}

function saveSize(element: HTMLElement): SavedSize {
  const style = element.style;
  return [
    element,
    style.width,
    style.getPropertyPriority("width"),
    style.height,
    style.getPropertyPriority("height"),
  ];
}

function restoreSize([
  element,
  width,
  widthPriority,
  height,
  heightPriority,
]: SavedSize): void {
  element.style.setProperty("width", width, widthPriority);
  element.style.setProperty("height", height, heightPriority);
}
