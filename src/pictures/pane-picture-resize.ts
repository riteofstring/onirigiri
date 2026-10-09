type SavedSize = readonly [HTMLElement, string, string, string, string];

export class PanePictureResize {
  private saved: SavedSize[] = [];
  private active = false;
  private source: SavedSize | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly content: HTMLElement,
  ) {}

  prepare(active: boolean): (() => void) | null {
    if (active === this.active) return null;
    const sizes: { element: HTMLElement; width: number; height: number }[] = [];
    if (active && !this.saved.length) {
      const picture = this.canvas.parentElement?.querySelector<HTMLElement>(
        ".onirigiri-pane__picture-surface",
      );
      for (const element of [this.canvas, picture]) {
        if (!element) continue;
        sizes.push({
          element,
          width: element.offsetWidth,
          height: element.offsetHeight,
        });
      }
    } else if (!active && this.saved.length) {
      const parent = this.canvas.parentElement!;
      sizes.push({
        element: this.content,
        width: parent.clientWidth,
        height: parent.clientHeight,
      });
    }
    return () => {
      this.active = active;
      for (const { element, width, height } of sizes) {
        if (active) this.saved.push(saveSize(element));
        else this.source ??= saveSize(element);
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
      }
    };
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
