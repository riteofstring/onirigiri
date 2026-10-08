// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { PanePictureContent } from "../src/pictures/pane-picture-content";
import { PaneCanvasSurface } from "../src/pictures/pane-picture-canvas";

function scrolledTo(element: Element, top: number) {
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    value: top,
  });
  element.dispatchEvent(new Event("scroll"));
}

describe("PanePictureContent", () => {
  it("prepares native-only content before readiness and reveals the same input when ready", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        frames.delete(id);
      });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const canvas = document.createElement("canvas");
    const content = document.createElement("div");
    const input = document.createElement("input");
    input.value = "Retained draft";
    content.append(input);
    canvas.append(content);
    document.body.append(canvas);
    let ready = false;
    let drawn = false;
    const surface = new PaneCanvasSurface(
      canvas,
      content,
      Promise.reject(new Error("Capture unavailable")),
      {
        continuous: () => true,
        canDraw: () => ready,
        canPrime: () => false,
        visible: () => true,
        renderer: () => "dom",
        displayScale: () => 1,
        revision: () => 0,
        drawn: (value) => {
          drawn = value;
        },
        failed: (error) => {
          throw error;
        },
      },
    );
    try {
      await Promise.resolve();
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(16);
      const host = content.parentElement!;
      expect(host).not.toBe(canvas);
      expect(host.hidden).toBe(false);
      expect(host.style.opacity).toBe("0");
      expect(drawn).toBe(false);

      ready = true;
      surface.requestPaint();
      expect(host.style.opacity).toBe("");
      expect(drawn).toBe(true);
      expect(host.querySelector("input")).toBe(input);
      expect(input.value).toBe("Retained draft");

      ready = false;
      surface.requestPaint();
      expect(content.parentElement).toBe(host);
      expect(host.style.opacity).toBe("");
      surface.dispose();
      expect(content.parentElement).toBe(canvas);
      expect(host.isConnected).toBe(false);
      expect(frames.size).toBe(0);
    } finally {
      surface.dispose();
      canvas.remove();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("restores scroll offsets across moves, scanning descendants only the first time", () => {
    const canvas = document.createElement("canvas");
    const content = document.createElement("div");
    const timeline = document.createElement("div");
    const untouched = document.createElement("div");
    content.append(timeline, untouched);
    document.body.append(canvas, content);
    const source = new PanePictureContent(canvas, content, {
      canPresent: () => true,
      changed: () => {},
      interactive: () => true,
      presented: () => {},
    });
    const scrollTo = vi.fn();
    timeline.scrollTo = scrollTo;
    const initial = document.createElement("div");
    content.append(initial);
    Object.defineProperty(initial, "scrollTop", {
      configurable: true,
      value: 64,
    });
    const initialScrollTo = vi.fn();
    initial.scrollTo = initialScrollTo;
    source.preserveScroll(() => {});
    expect(initialScrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 64,
      behavior: "instant",
    });

    const untouchedReads = vi.fn(() => 0);
    Object.defineProperty(untouched, "scrollTop", { get: untouchedReads });

    scrolledTo(timeline, 480);
    const update = vi.fn();
    source.preserveScroll(update);

    expect(update).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 480,
      behavior: "instant",
    });
    expect(untouchedReads).not.toHaveBeenCalled();

    timeline.remove();
    scrollTo.mockClear();
    source.preserveScroll(() => {});
    expect(scrollTo).not.toHaveBeenCalled();

    source.dispose();
    content.remove();
    canvas.remove();
  });
});
