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
  it("keeps native input live while shared display preparation outlasts an aborted capture", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const flushFrames = () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(16);
    };
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("GPUTextureUsage", {
      COPY_SRC: 1,
      COPY_DST: 2,
      TEXTURE_BINDING: 4,
      RENDER_ATTACHMENT: 16,
    });
    const parent = document.createElement("div");
    const canvas = document.createElement("canvas");
    const content = document.createElement("div");
    const input = document.createElement("input");
    input.value = "Retained draft";
    content.append(input);
    canvas.append(content);
    parent.append(canvas);
    document.body.append(parent);
    Object.defineProperties(content, {
      offsetWidth: { value: 480 },
      offsetHeight: { value: 354 },
    });
    vi.spyOn(canvas, "getContext").mockReturnValue({
      configure: vi.fn(),
      unconfigure: vi.fn(),
    } as unknown as GPUCanvasContext);
    let complete!: (pipeline: GPURenderPipeline) => void;
    const compilation = new Promise<GPURenderPipeline>((resolve) => {
      complete = resolve;
    });
    const compile = vi.fn(() => compilation);
    const destroy = vi.fn();
    const device = {
      lost: new Promise(() => {}),
      limits: { maxTextureDimension2D: 8192 },
      createShaderModule: () => ({}),
      createRenderPipelineAsync: compile,
      createTexture: () => ({ width: 480, height: 354, destroy }),
    } as unknown as GPUDevice;
    const surface = new PaneCanvasSurface(
      canvas,
      content,
      Promise.resolve(device),
      {
        continuous: () => false,
        canDraw: () => true,
        canPrime: () => false,
        visible: () => true,
        interactive: () => true,
        renderer: () => "dom",
        displayScale: () => 1,
        revision: () => 0,
        drawn: () => {},
        failed: (error) => {
          throw error;
        },
      },
    );
    const controllers = [new AbortController(), new AbortController()];
    const captures: Promise<unknown>[] = [];
    const rejected: unknown[] = [];
    try {
      await Promise.resolve();
      flushFrames();
      const host = content.parentElement!;
      expect(host).not.toBe(canvas);
      input.focus();
      for (const [index, controller] of controllers.entries()) {
        const capture = surface.capture({
          signal: controller.signal,
          stage: false,
          maxRasterBytes: 4 * 1024 * 1024,
          maxEncodedBytes: 4 * 1024 * 1024,
        });
        captures.push(capture);
        void capture.catch((error: unknown) => {
          rejected[index] = error;
        });
      }
      surface.requestPaint();
      flushFrames();
      expect(content.parentElement).toBe(host);
      expect(host.hidden).toBe(false);
      expect(host.style.opacity).toBe("");
      expect(content.dataset.onirigiriLive).toBe("true");
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("Retained draft");
      input.value = "Typed while preparing";
      const firstReason = new Error("Navigation cancelled capture");
      controllers[0]!.abort(firstReason);
      await vi.waitFor(() => expect(rejected[0]).toBe(firstReason));
      surface.requestPaint();
      flushFrames();
      expect(rejected[1]).toBeUndefined();
      expect(content.parentElement).toBe(host);
      expect(host.hidden).toBe(false);
      expect(host.style.opacity).toBe("");
      expect(host.querySelector("input")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(compile).toHaveBeenCalledOnce();

      complete({} as GPURenderPipeline);
      await vi.waitFor(() => expect(content.parentElement).toBe(canvas));
      expect(host.hidden).toBe(true);
      expect(input.value).toBe("Typed while preparing");
      expect(compile).toHaveBeenCalledOnce();
      const secondReason = new Error("Capture interrupted during recording");
      controllers[1]!.abort(secondReason);
      await expect(captures[1]).rejects.toBe(secondReason);
      flushFrames();
      expect(content.parentElement).toBe(host);
      expect(host.hidden).toBe(false);
      expect(host.style.opacity).toBe("");
      expect(host.querySelector("input")).toBe(input);
      expect(input.value).toBe("Typed while preparing");
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      for (const controller of controllers) controller.abort();
      complete({} as GPURenderPipeline);
      await Promise.allSettled(captures);
      surface.dispose();
      parent.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("keeps resize dimensions when an aborted staged capture finishes cleaning up", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++sequence, callback);
      return sequence;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("GPUTextureUsage", {
      COPY_SRC: 1,
      COPY_DST: 2,
      TEXTURE_BINDING: 4,
      RENDER_ATTACHMENT: 16,
    });
    const parent = document.createElement("div");
    const canvas = document.createElement("canvas");
    const content = document.createElement("div");
    const input = document.createElement("input");
    input.value = "Retained draft";
    content.append(input);
    canvas.append(content);
    parent.append(canvas);
    document.body.append(parent);
    canvas.style.setProperty("--consumer-color", "red");
    for (const element of [canvas, content, parent]) {
      Object.defineProperties(element, {
        offsetWidth: { get: () => 480 },
        offsetHeight: { get: () => 354 },
        clientWidth: { get: () => 480 },
        clientHeight: { get: () => 354 },
      });
    }
    let popover = false;
    canvas.showPopover = () => {
      popover = true;
    };
    canvas.hidePopover = () => {
      popover = false;
    };
    const matches = canvas.matches.bind(canvas);
    vi.spyOn(canvas, "matches").mockImplementation((selector) =>
      selector === ":popover-open" ? popover : matches(selector),
    );
    vi.spyOn(canvas, "getContext").mockReturnValue({
      configure: vi.fn(),
      unconfigure: vi.fn(),
    } as unknown as GPUCanvasContext);
    const destroy = vi.fn();
    const device = {
      lost: new Promise(() => {}),
      limits: { maxTextureDimension2D: 8192 },
      createTexture: () => ({ width: 480, height: 354, destroy }),
    } as unknown as GPUDevice;
    let live = false;
    const surface = new PaneCanvasSurface(
      canvas,
      content,
      Promise.resolve(device),
      {
        continuous: () => false,
        canDraw: () => live,
        canPrime: () => false,
        visible: () => true,
        renderer: () => "dom",
        displayScale: () => 1,
        revision: () => 0,
        drawn: () => {},
        failed: (error) => {
          throw error;
        },
      },
    );
    try {
      await Promise.resolve();
      const controller = new AbortController();
      const pending = surface.capture({
        signal: controller.signal,
        stage: true,
        maxRasterBytes: 4 * 1024 * 1024,
        maxEncodedBytes: 4 * 1024 * 1024,
      });
      expect(popover).toBe(true);
      const reason = new Error("Resize started");
      controller.abort(reason);
      surface.setResizing(true);
      await expect(pending).rejects.toBe(reason);
      expect(popover).toBe(false);
      expect(canvas.style.width).toBe("480px");
      expect(canvas.style.height).toBe("354px");
      expect(canvas.style.position).toBe("");
      expect(canvas.style.getPropertyValue("--consumer-color")).toBe("red");
      expect(destroy).toHaveBeenCalledOnce();

      surface.setResizing(false);
      live = true;
      surface.requestPaint();
      const pendingFrames = [...frames.values()];
      frames.clear();
      for (const callback of pendingFrames) callback(16);
      expect(canvas.style.width).toBe("");
      expect(canvas.style.height).toBe("");
      expect(content.parentElement).not.toBe(canvas);
      expect(content.querySelector("input")).toBe(input);
      expect(input.value).toBe("Retained draft");
    } finally {
      surface.dispose();
      parent.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("checks focused priming once per paint and rechecks before the native handoff", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.set(++frameId, callback);
        return frameId;
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
    vi.stubGlobal("GPUTextureUsage", { COPY_DST: 2, RENDER_ATTACHMENT: 16 });
    const canvas = document.createElement("canvas");
    const content = document.createElement("div");
    const input = document.createElement("input");
    input.value = "Retained draft";
    content.append(input);
    canvas.append(content);
    document.body.append(canvas);
    vi.spyOn(canvas, "getContext").mockReturnValue({
      configure: vi.fn(),
      unconfigure: vi.fn(),
    } as unknown as GPUCanvasContext);
    let prime = false;
    let drawn = false;
    let renderer: "canvas" | "dom" = "canvas";
    const canPrime = vi.fn(() => prime && !drawn);
    const surface = new PaneCanvasSurface(
      canvas,
      content,
      Promise.resolve({
        lost: new Promise(() => {}),
      } as GPUDevice),
      {
        continuous: () => false,
        canDraw: () => false,
        canPrime,
        visible: () => true,
        renderer: () => renderer,
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
    const flushFrames = () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(16);
    };
    try {
      await Promise.resolve();
      prime = true;
      canPrime.mockClear();
      surface.requestPaint();
      expect(canPrime).toHaveBeenCalledOnce();
      expect(content.parentElement).toBe(canvas);

      renderer = "dom";
      prime = false;
      canPrime.mockClear();
      surface.requestPaint();
      expect(canPrime).toHaveBeenCalledOnce();
      expect(frames.size).toBe(0);

      prime = true;
      canPrime.mockClear();
      surface.requestPaint();
      expect(canPrime).toHaveBeenCalledOnce();
      prime = false;
      flushFrames();
      expect(canPrime).toHaveBeenCalledTimes(2);
      expect(content.parentElement).toBe(canvas);
      expect(drawn).toBe(false);

      prime = true;
      surface.requestPaint();
      flushFrames();
      expect(content.parentElement).not.toBe(canvas);
      expect(content.parentElement!.style.opacity).toBe("");
      expect(drawn).toBe(true);
      expect(content.querySelector("input")).toBe(input);
      expect(input.value).toBe("Retained draft");
    } finally {
      surface.dispose();
      canvas.remove();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.unstubAllGlobals();
    }
  });

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

  it("restores scroll offsets across moves, scanning descendants only the first time", async () => {
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

    const group = document.createElement("div");
    content.append(group);
    group.append(timeline);
    await Promise.resolve();
    scrollTo.mockClear();
    source.preserveScroll(() => {});
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
