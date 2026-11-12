// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  canDrawElementImages,
  drawElementImage,
  elementImageWidth,
  markElementCanvas,
  type ElementCanvas,
} from "../src/pictures/pane-picture-canvas-api.js";

const texture = { width: 520, height: 400 } as GPUTexture;

describe("HTML-in-Canvas shapes", () => {
  it("marks a canvas for both the Chrome 152 and the Chrome 157 shape", () => {
    const canvas = document.createElement("canvas");
    markElementCanvas(canvas);
    expect(canvas.hasAttribute("layoutsubtree")).toBe(true);
    expect(canvas.getAttribute("content")).toBe("drawable");
  });

  it("reads an image's width from the image up to Chrome 156 and from the canvas after", () => {
    const sized = vi.fn(() => ({ width: 1040, height: 800 }));
    const canvas = { getElementImageDefaultSize: sized } as unknown as ElementCanvas;
    expect(elementImageWidth(canvas, { width: 520, close() {} })).toBe(520);
    expect(sized).not.toHaveBeenCalled();
    expect(elementImageWidth(canvas, { close() {} })).toBe(1040);
  });

  it("copies with the queue call each Chrome shape has, and reports neither as unsupported", () => {
    const image = { close() {} };
    const copy = vi.fn();
    drawElementImage({ copyElementImageToTexture: copy } as never, image, texture, true);
    expect(copy).toHaveBeenCalledWith(
      { source: image },
      { destination: { texture, premultipliedAlpha: true }, width: 520, height: 400 },
    );
    const draw = vi.fn();
    drawElementImage({ drawElementImageToTexture: draw } as never, image, texture, false);
    expect(draw).toHaveBeenCalledWith({ source: image }, { texture, premultipliedAlpha: false });
    expect(canDrawElementImages({ copyElementImageToTexture: copy } as never)).toBe(true);
    expect(canDrawElementImages({ drawElementImageToTexture: draw } as never)).toBe(true);
    expect(canDrawElementImages({} as never)).toBe(false);
  });
});
