export interface ElementImage {
  close(): void;
}

export interface ElementCanvas extends HTMLCanvasElement {
  requestPaint(): void;
  captureElementImage(element: Element): ElementImage;
  getElementImageDefaultSize(image: ElementImage): {
    width: number;
    height: number;
  };
  updateElementGeometry?(element: Element): void;
  clearElementGeometry?(element: Element): void;
}

export interface ElementPaintEvent extends Event {
  readonly changedElements: readonly Element[];
}

export interface ElementQueue extends GPUQueue {
  drawElementImageToTexture(
    source: { source: ElementImage },
    destination: { texture: GPUTexture; premultipliedAlpha: boolean },
  ): void;
}

/** Makes a canvas lay out and draw its children (Chrome 157: `content="drawable"`). */
export function markElementCanvas(canvas: Element): void {
  canvas.setAttribute("content", "drawable");
}

export function canDrawElementImages(queue: GPUQueue): boolean {
  return (
    typeof (queue as Partial<ElementQueue>).drawElementImageToTexture ===
    "function"
  );
}

export function drawElementImage(
  queue: GPUQueue,
  image: ElementImage,
  texture: GPUTexture,
  premultipliedAlpha: boolean,
): void {
  (queue as ElementQueue).drawElementImageToTexture(
    { source: image },
    { texture, premultipliedAlpha },
  );
}
