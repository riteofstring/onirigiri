export interface ElementImage {
  readonly width: number;
  close(): void;
}

export interface ElementCanvas extends HTMLCanvasElement {
  requestPaint(): void;
  captureElementImage(element: Element): ElementImage;
  updateElementGeometry?(element: Element): void;
  clearElementGeometry?(element: Element): void;
}

export interface ElementPaintEvent extends Event {
  readonly changedElements: readonly Element[];
}

export interface ElementQueue extends GPUQueue {
  copyElementImageToTexture(
    source: { source: ElementImage },
    destination: {
      destination: { texture: GPUTexture; premultipliedAlpha: boolean };
      width: number;
      height: number;
    },
  ): void;
}
