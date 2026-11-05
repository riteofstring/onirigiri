// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { PanePictureContent } from "../src/pictures/pane-picture-content";
import {
  PaneCanvasSurface,
  captureOnirigiriPanePicture,
} from "../src/pictures/pane-picture-canvas";
import { PanePictureCaptureClient } from "../src/pictures/pane-picture-capture-client";

type SurfaceCallbacks = ConstructorParameters<typeof PaneCanvasSurface>[3];

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function scrolledTo(element: Element, top: number) {
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    value: top,
  });
  element.dispatchEvent(new Event("scroll"));
}

function paneCanvas(context: object = {}) {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
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
  cleanups.push(() => parent.remove());
  const gpuContext = { configure: vi.fn(), unconfigure: vi.fn(), ...context };
  vi.spyOn(canvas, "getContext").mockReturnValue(
    gpuContext as unknown as GPUCanvasContext,
  );
  return {
    canvas,
    content,
    context: gpuContext,
    frames,
    input,
    flushFrames() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(16);
    },
    surface(device: Promise<GPUDevice>, callbacks: Partial<SurfaceCallbacks>) {
      const surface = new PaneCanvasSurface(canvas, content, device, {
        continuous: () => false,
        canDraw: () => true,
        canPrime: () => false,
        visible: () => true,
        renderer: () => "dom",
        displayScale: () => 1,
        revision: () => 0,
        drawn: () => {},
        failed: (error) => {
          throw error;
        },
        ...callbacks,
      });
      cleanups.push(() => surface.dispose());
      return surface;
    },
  };
}

describe("PanePictureContent", () => {
  it("leaves unregistered and unsupported content native without capture substitutes", async () => {
    const pane = paneCanvas();
    const signal = new AbortController().signal;
    expect(await captureOnirigiriPanePicture(pane.input, signal)).toBeNull();
    const surface = pane.surface(
      Promise.reject(new Error("No HTML-in-Canvas")),
      {},
    );
    await Promise.resolve();
    pane.flushFrames();
    expect(await captureOnirigiriPanePicture(pane.input, signal)).toBeNull();
    expect(pane.content.querySelector("input")).toBe(pane.input);
    expect(pane.input.value).toBe("Retained draft");
    expect(surface.canCapture()).toBe(false);
  });

  it("keeps consumer extraction serial across mounted panes and cancels worker preparation", async () => {
    const first = paneCanvas();
    const second = paneCanvas();
    const device = { lost: new Promise(() => {}) } as unknown as GPUDevice;
    first.surface(Promise.resolve(device), {});
    second.surface(Promise.resolve(device), {});
    await Promise.resolve();
    let preparedSignal: AbortSignal | undefined;
    vi.spyOn(PanePictureCaptureClient.prototype, "prepare").mockImplementation(
      (signal) => {
        preparedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );
    const controller = new AbortController();
    const result = captureOnirigiriPanePicture(first.input, controller.signal);
    expect(
      await captureOnirigiriPanePicture(
        second.input,
        new AbortController().signal,
      ),
    ).toBeNull();
    controller.abort(new DOMException("Input", "AbortError"));
    await expect(result).rejects.toThrow("Input");
    expect(preparedSignal?.aborted).toBe(true);
    expect(first.input.value).toBe("Retained draft");
    expect(second.input.value).toBe("Retained draft");
  });

  it("finishes encoding a recorded staged capture after its signal aborts", async () => {
    const pane = paneCanvas();
    const device = { lost: new Promise(() => {}) } as unknown as GPUDevice;
    const surface = pane.surface(Promise.resolve(device), {
      visible: () => false,
    });
    await Promise.resolve();
    const internals = surface as unknown as Record<string, unknown>;
    vi.spyOn(internals as never, "stageWorker" as never).mockReturnValue(
      (() => {}) as never,
    );
    vi.spyOn(internals as never, "rasterSize" as never).mockReturnValue({
      width: 100,
      height: 100,
    } as never);
    vi.spyOn(internals as never, "settleStage" as never).mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(
      internals as never,
      "recordWorkerImage" as never,
    ).mockResolvedValue({ close: () => {} } as never);
    let encode!: (image: Blob) => void;
    let encodeSignal: AbortSignal | undefined;
    const client = {
      prepare: vi.fn(async () => ({
        canvas: document.createElement("canvas"),
        limit: 1024 * 1024,
      })),
      capture: vi.fn(
        (_id: string, _image: unknown, _size: unknown, signal: AbortSignal) => {
          encodeSignal = signal;
          return new Promise<Blob>((resolve) => {
            encode = resolve;
          });
        },
      ),
    } as unknown as PanePictureCaptureClient;
    const controller = new AbortController();
    const recorded = vi.fn(() =>
      controller.abort(new DOMException("Motion", "AbortError")),
    );
    const capture = surface.capture({
      stage: true,
      signal: controller.signal,
      recorded,
      maxRasterBytes: 1024 * 1024,
      maxEncodedBytes: 1024 * 1024,
      background: { id: "recorded", client, required: true },
    });
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledOnce());
    expect(recorded).toHaveBeenCalledOnce();
    expect(controller.signal.aborted).toBe(true);
    expect(encodeSignal?.aborted).toBe(false);
    encode(new Blob(["pixels"]));
    expect((await capture).image.size).toBe(6);
  });

  it.each([true, false])(
    "captures consumer pixels without relocating visible content (%s)",
    async (visible) => {
      const pane = paneCanvas();
      const device = { lost: new Promise(() => {}) } as unknown as GPUDevice;
      const surface = pane.surface(Promise.resolve(device), {
        visible: () => visible,
      });
      await Promise.resolve();
      vi.spyOn(PanePictureCaptureClient.prototype, "prepare").mockResolvedValue(
        {} as never,
      );
      const capture = vi
        .spyOn(surface, "capture")
        .mockImplementation(async (request) => {
          if (visible) expect(request.stage).toBe(false);
          else expect(request.stage).toBe(true);
          expect(pane.input.value).toBe("Retained draft");
          return { image: new Blob(["pixels"]), width: 100, height: 100 };
        });
      const result = await captureOnirigiriPanePicture(
        pane.input,
        new AbortController().signal,
      );
      expect(capture).toHaveBeenCalledOnce();
      expect(result?.image.size).toBe(6);
    },
  );

  it.each(["dom", "canvas"] as const)(
    "recovers %s content immediately when device loss aborts pending capture preparation",
    async (renderer) => {
      const { canvas, content, context, input, flushFrames, ...pane } =
        paneCanvas();
      let lose!: (info: GPUDeviceLostInfo) => void;
      const device = {
        lost: new Promise<GPUDeviceLostInfo>((resolve) => {
          lose = resolve;
        }),
      } as GPUDevice;
      const drawn = vi.fn();
      const failed = vi.fn();
      const surface = pane.surface(Promise.resolve(device), {
        continuous: () => true,
        renderer: () => renderer,
        drawn,
        failed,
      });
      let finishPreparation!: (value: null) => void;
      const prepare = vi.fn(
        (_signal: AbortSignal) =>
          new Promise<null>((resolve) => {
            finishPreparation = resolve;
          }),
      );
      await Promise.resolve();
      flushFrames();
      input.focus();
      const capture = surface
        .capture({
          stage: true,
          signal: new AbortController().signal,
          maxRasterBytes: 1024 * 1024,
          maxEncodedBytes: 1024 * 1024,
          background: {
            id: "lost-device",
            client: { prepare } as unknown as PanePictureCaptureClient,
          },
        })
        .catch((error: unknown) => error);
      expect(prepare).toHaveBeenCalledOnce();
      lose({ reason: "destroyed", message: "Device reset" });
      await Promise.resolve();
      flushFrames();
      const signal = prepare.mock.calls[0]![0];
      expect(signal.aborted).toBe(true);
      expect(signal.reason.message).toContain("Device reset");
      expect(surface.canCapture()).toBe(false);
      expect(canvas.dataset.onirigiriNativeActive).toBe("true");
      expect(content.parentElement).not.toBe(canvas);
      expect(content.parentElement!.hidden).toBe(false);
      expect(content.parentElement!.style.opacity).toBe("");
      expect(content.dataset.onirigiriLive).toBe("true");
      expect(content.querySelector("input")).toBe(input);
      expect(input.value).toBe("Retained draft");
      expect(drawn).toHaveBeenLastCalledWith(true, "dom");
      if (renderer === "dom") expect(drawn).not.toHaveBeenCalledWith(false);
      expect(failed).not.toHaveBeenCalled();
      expect(context.unconfigure).toHaveBeenCalledOnce();
      input.value = "Edited after device loss";
      finishPreparation(null);
      expect(await capture).toBe(signal.reason);
      flushFrames();
      expect(input.value).toBe("Edited after device loss");
      expect(content.dataset.onirigiriLive).toBe("true");
      await expect(
        surface.capture({
          stage: false,
          signal: new AbortController().signal,
          maxRasterBytes: 1024,
          maxEncodedBytes: 1024,
        }),
      ).rejects.toThrow("Pane canvas is not ready");
    },
  );

  it("withdraws a frozen canvas frame on device loss and shows native content in its place", async () => {
    const { canvas, content, input, flushFrames, ...pane } = paneCanvas({
      getCurrentTexture: () => ({ width: 20, height: 12 }),
    });
    Object.defineProperties(content, {
      offsetWidth: { get: () => 20 },
      offsetHeight: { get: () => 12 },
    });
    const close = vi.fn();
    Object.assign(canvas, {
      requestPaint: vi.fn(),
      captureElementImage: () => ({ width: 20, close }),
    });
    let lose!: (info: GPUDeviceLostInfo) => void;
    const device = {
      lost: new Promise<GPUDeviceLostInfo>((resolve) => {
        lose = resolve;
      }),
      limits: { maxTextureDimension2D: 8192 },
      queue: { copyElementImageToTexture: vi.fn() },
    } as unknown as GPUDevice;
    let live = true;
    const drawn = vi.fn();
    const failed = vi.fn();
    const surface = pane.surface(Promise.resolve(device), {
      canDraw: () => live,
      renderer: () => "canvas",
      drawn,
      failed,
    });
    await Promise.resolve();
    canvas.dispatchEvent(
      Object.assign(new Event("paint"), { changedElements: [content] }),
    );
    expect(drawn).toHaveBeenLastCalledWith(true, "canvas");
    live = false;
    surface.requestPaint();
    canvas.dispatchEvent(
      Object.assign(new Event("paint"), { changedElements: [content] }),
    );
    expect(drawn).toHaveBeenLastCalledWith(true, "canvas");
    lose({ reason: "destroyed", message: "Device reset" });
    await Promise.resolve();
    flushFrames();
    expect(drawn).toHaveBeenCalledWith(false);
    expect(failed).not.toHaveBeenCalled();
    expect(surface.hasCurrentFrame()).toBe(false);
    expect(content.parentElement).not.toBe(canvas);
    expect(content.parentElement!.style.opacity).toBe("");
    expect(content.querySelector("input")).toBe(input);
    live = true;
    surface.requestPaint();
    expect(drawn).toHaveBeenLastCalledWith(true, "dom");
    expect(content.parentElement!.style.opacity).toBe("");
    expect(input.value).toBe("Retained draft");
  });

  it("keeps native input live while shared display preparation outlasts an aborted capture", async () => {
    const { canvas, content, input, flushFrames, ...pane } = paneCanvas();
    Object.defineProperties(content, {
      offsetWidth: { value: 480 },
      offsetHeight: { value: 354 },
    });
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
    const surface = pane.surface(Promise.resolve(device), {
      interactive: () => true,
    });
    const controllers = [new AbortController(), new AbortController()];
    const captures: Promise<unknown>[] = [];
    const rejected: unknown[] = [];
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
  });

  it("keeps resize dimensions when an aborted staged capture finishes cleaning up", async () => {
    const { canvas, content, input, flushFrames, ...pane } = paneCanvas();
    canvas.style.setProperty("--consumer-color", "red");
    for (const element of [canvas, content, canvas.parentElement!]) {
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
    const destroy = vi.fn();
    const device = {
      lost: new Promise(() => {}),
      limits: { maxTextureDimension2D: 8192 },
      createTexture: () => ({ width: 480, height: 354, destroy }),
    } as unknown as GPUDevice;
    let live = false;
    const surface = pane.surface(Promise.resolve(device), {
      canDraw: () => live,
    });
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
    flushFrames();
    expect(canvas.style.width).toBe("");
    expect(canvas.style.height).toBe("");
    expect(content.parentElement).not.toBe(canvas);
    expect(content.querySelector("input")).toBe(input);
    expect(input.value).toBe("Retained draft");
  });

  it("shows DOM content natively while the canvas has no frame, without waiting for readiness", async () => {
    const { canvas, content, input, flushFrames, ...pane } = paneCanvas();
    let drawn = false;
    let renderer: "canvas" | "dom" = "canvas";
    const surface = pane.surface(
      Promise.resolve({ lost: new Promise(() => {}) } as GPUDevice),
      {
        canDraw: () => false,
        canPrime: () => false,
        renderer: () => renderer,
        drawn: (value) => {
          drawn = value;
        },
      },
    );
    await Promise.resolve();
    surface.requestPaint();
    flushFrames();
    expect(content.parentElement).toBe(canvas);

    renderer = "dom";
    surface.requestPaint();
    flushFrames();
    expect(content.parentElement).not.toBe(canvas);
    expect(content.parentElement!.hidden).toBe(false);
    expect(content.parentElement!.style.opacity).toBe("");
    expect(drawn).toBe(true);
    expect(content.querySelector("input")).toBe(input);
    expect(input.value).toBe("Retained draft");
  });

  it("shows native-only content before readiness and keeps the same input when ready", async () => {
    const { canvas, content, input, frames, flushFrames, ...pane } =
      paneCanvas();
    let ready = false;
    let drawn = false;
    const surface = pane.surface(
      Promise.reject(new Error("Capture unavailable")),
      {
        continuous: () => true,
        canDraw: () => ready,
        drawn: (value) => {
          drawn = value;
        },
      },
    );
    await Promise.resolve();
    flushFrames();
    const host = content.parentElement!;
    expect(host).not.toBe(canvas);
    expect(host.hidden).toBe(false);
    expect(host.style.opacity).toBe("");
    expect(drawn).toBe(true);

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
