export interface ElementImage {
  /** Present on Chrome 152 and 156; Chrome 157 reports the size through the canvas. */
  readonly width?: number;
  close(): void;
}

export interface ElementCanvas extends HTMLCanvasElement {
  requestPaint(): void;
  captureElementImage(element: Element): ElementImage;
  /** Chrome 157 and later. */
  getElementImageDefaultSize?(image: ElementImage): {
    width: number;
    height: number;
  };
  updateElementGeometry?(element: Element): void;
  clearElementGeometry?(element: Element): void;
}

export interface ElementPaintEvent extends Event {
  readonly changedElements: readonly Element[];
}

// HTML-in-Canvas is experimental and its shape differs by Chrome version. The desktop app embeds
// Chrome 152 (Electron 44) while browsers are on 157 or later, so both shapes are supported:
//   seen on 152 and 156: <canvas layoutsubtree>, ElementImage.width,
//                        queue.copyElementImageToTexture
//   seen on 157:         <canvas content="drawable"> with drawable children,
//                        canvas.getElementImageDefaultSize, queue.drawElementImageToTexture
// Each helper picks by what the browser offers, not by version.
export interface ElementQueue extends GPUQueue {
  copyElementImageToTexture?(
    source: { source: ElementImage },
    destination: {
      destination: { texture: GPUTexture; premultipliedAlpha: boolean };
      width: number;
      height: number;
    },
  ): void;
  drawElementImageToTexture?(
    source: { source: ElementImage },
    destination: { texture: GPUTexture; premultipliedAlpha: boolean },
  ): void;
}

/** Makes a canvas lay out and draw its children: one attribute for each Chrome shape. */
export const ELEMENT_CANVAS_ATTRIBUTES = {
  layoutsubtree: "",
  content: "drawable",
} as const;

export function markElementCanvas(canvas: Element): void {
  for (const [name, value] of Object.entries(ELEMENT_CANVAS_ATTRIBUTES))
    canvas.setAttribute(name, value);
}

/** The captured image's width in canvas buffer pixels. */
export function elementImageWidth(
  canvas: ElementCanvas,
  image: ElementImage,
): number {
  return image.width ?? canvas.getElementImageDefaultSize!(image).width;
}

export function canDrawElementImages(queue: GPUQueue): boolean {
  const { copyElementImageToTexture, drawElementImageToTexture } =
    queue as ElementQueue;
  return (
    typeof copyElementImageToTexture === "function" ||
    typeof drawElementImageToTexture === "function"
  );
}

export function drawElementImage(
  queue: GPUQueue,
  image: ElementImage,
  texture: GPUTexture,
  premultipliedAlpha: boolean,
): void {
  const elementQueue = queue as ElementQueue;
  if (elementQueue.copyElementImageToTexture)
    elementQueue.copyElementImageToTexture(
      { source: image },
      {
        destination: { texture, premultipliedAlpha },
        width: texture.width,
        height: texture.height,
      },
    );
  else
    elementQueue.drawElementImageToTexture!(
      { source: image },
      { texture, premultipliedAlpha },
    );
}
