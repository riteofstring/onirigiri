// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanePictures } from "../src/pictures/pane-pictures";
import {
  PanePresentationPolicy,
  type PanePresentationContext,
} from "../src/presentation/pane-presentation-policy";
import { PaneContentReadiness } from "../src/panes/pane-content-readiness";
import { PaneContentPreloader } from "../src/panes/pane-content-preloader";
import type { OnirigiriPanePicture } from "../src/pictures/pane-picture-types";
import { createWorkspaceScene } from "../src/workspace/workspace-scene";
import { renderItem } from "./pane-presentation-engine-test-support";

describe("pane presentation policy", () => {
  const pane = createWorkspaceScene({
    panes: [{ paneId: "video", surfaceKind: "media", title: "Video" }],
  }).scene.paneById.get("video")!;
  const context: PanePresentationContext = {
    phase: "rest",
    focused: true,
    maximized: false,
    visible: true,
    capabilities: { canCapture: true, hasVideo: true },
  };
  it("keeps capturable video native automatically and falls back to native graphics without losing the requested mode", () => {
    const policy = new PanePresentationPolicy();
    expect(policy.resolve(pane, context)).toMatchObject({
      requested: "auto",
      kind: "dom",
      reason: "native-presentation",
    });
    policy.configure("canvas");
    expect(
      policy.resolve(pane, {
        ...context,
        capabilities: { canCapture: false, hasVideo: true },
      }),
    ).toMatchObject({
      requested: "canvas",
      kind: "dom",
      reason: "capture-unavailable",
    });
    expect(policy.resolve(pane, context).kind).toBe("canvas");
    policy.configure("dom");
    expect(policy.resolve(pane, context).kind).toBe("dom");
  });
  it("resolves group and phase choices only when semantic inputs change", () => {
    const resolver = vi.fn((value, state: PanePresentationContext) =>
      value.surfaceKind === "media" && state.phase === "overview"
        ? {
            kind: "texture" as const,
            detail: "preview" as const,
            reason: "overview-budget",
          }
        : undefined,
    );
    const policy = new PanePresentationPolicy();
    policy.configure("dom", resolver);
    policy.resolve(pane, context);
    policy.resolve(pane, { ...context });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(
      policy.resolve(pane, { ...context, phase: "overview" }),
    ).toMatchObject({
      kind: "texture",
      detail: "preview",
      reason: "overview-budget",
    });
    expect(resolver).toHaveBeenCalledTimes(2);
    policy.configure({ kind: "placeholder", variant: "paused" });
    expect(policy.resolve(pane, context)).toMatchObject({
      kind: "placeholder",
      variant: "paused",
    });
  });
  it("keeps equivalent object policies cached and contains resolver failures", () => {
    const policy = new PanePresentationPolicy();
    const resolve = vi.fn(() => undefined);
    policy.configure({ kind: "dom", reason: "native" }, resolve);
    policy.resolve(pane, context);
    policy.configure({ kind: "dom", reason: "native" }, resolve);
    policy.resolve(pane, context);
    expect(resolve).toHaveBeenCalledTimes(1);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failure = vi.fn(() => {
        throw new Error("Invalid group rule");
      });
      policy.configure("canvas", failure);
      expect(policy.resolve(pane, context)).toMatchObject({
        kind: "dom",
        reason: "policy-error",
      });
      policy.resolve(pane, { ...context });
      expect(failure).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});

interface CanvasRequest {
  width: number;
  height: number;
  signal: AbortSignal;
  stage: boolean;
}
interface CanvasPicture {
  image: Blob;
  width: number;
  height: number;
}
type CanvasCapture = (request: CanvasRequest) => Promise<CanvasPicture>;
const canvasMock = vi.hoisted(() => ({
  capture: null as CanvasCapture | null,
  frameVersion: 0,
  unpainted: new WeakSet<HTMLElement>(),
  uncapturable: new WeakSet<HTMLElement>(),
}));
const preparePanePictureTexture = vi.hoisted(() =>
  vi.fn(async (_document, _device, _image, size) => ({
    ...size,
    present: vi.fn((canvas: HTMLCanvasElement) => {
      canvas.width = size.width;
      canvas.height = size.height;
      return () => {
        canvas.width = canvas.height = 1;
      };
    }),
    dispose: vi.fn(),
  })),
);
vi.mock("../src/pictures/pane-picture-texture", () => ({
  preparePanePictureTexture,
}));
vi.mock("../src/pictures/pane-picture-canvas", () => ({
  createPaneCanvasDevice: async () => ({ destroy: vi.fn() }),
  PaneCanvasSurface: class {
    get frameVersion() {
      return canvasMock.frameVersion;
    }
    constructor(
      _canvas: HTMLCanvasElement,
      private content: HTMLElement,
      _device: unknown,
      callbacks: { drawn(ready: boolean): void },
    ) {
      queueMicrotask(() => callbacks.drawn(!canvasMock.unpainted.has(content)));
      Object.defineProperties(content, {
        offsetWidth: {
          configurable: true,
          get: () => content.getBoundingClientRect().width,
        },
        offsetHeight: {
          configurable: true,
          get: () => content.getBoundingClientRect().height,
        },
      });
    }
    requestPaint() {}
    dispose() {}
    clear() {}
    setResizing() {}
    hasVideo() {
      return false;
    }
    canCapture() {
      return !canvasMock.uncapturable.has(this.content);
    }
    hasCurrentFrame() {
      return true;
    }
    capture(request: { signal: AbortSignal; stage: boolean }) {
      if (!canvasMock.capture)
        return Promise.reject(new Error("Test surface unavailable"));
      return canvasMock.capture({
        ...request,
        width: this.content.offsetWidth,
        height: this.content.offsetHeight,
      });
    }
  },
}));

function png(width = 200, height = 100, extra = 20): Blob {
  const bytes = new Uint8Array(24 + extra);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new NodeBlob([bytes], { type: "image/png" }) as Blob;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("engine pane pictures", () => {
  const cleanups: (() => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    capture.mockClear();
    vi.mocked(preparePanePictureTexture).mockClear();
    canvasMock.frameVersion = 0;
    frameCadence(16);
    let url = 0;
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:picture-${++url}`),
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.querySelector("[data-content]")),
    });
    Object.defineProperty(window, "createImageBitmap", {
      configurable: true,
      value: vi.fn(async (blob: Blob) => {
        const view = new DataView(await blob.slice(0, 24).arrayBuffer());
        return {
          width: view.getUint32(16),
          height: view.getUint32(20),
          close: vi.fn(),
        };
      }),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, callback) {
        callback(png(this.width, this.height));
      },
    );
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function fixture(capture?: CanvasCapture) {
    canvasMock.capture = capture ?? null;
    const scene = createWorkspaceScene({
      panes: [
        { paneId: "a", title: "A", surfaceKind: "anything" },
        { paneId: "b", title: "B", surfaceKind: "other" },
      ],
    });
    const root = document.createElement("div");
    const content = document.createElement("div");
    content.dataset.content = "true";
    root.append(content);
    document.body.append(root);
    let bounds = new DOMRect(40, 60, 200, 100);
    vi.spyOn(content, "getBoundingClientRect").mockImplementation(() => bounds);
    let moving = false;
    let overview = false;
    let focused = "a";
    const pictures = new PanePictures(
      () => moving,
      () => focused,
      () => overview,
    );
    const readiness = new PaneContentReadiness();
    const config = {
      panes: scene.scene.paneById,
      items: [renderItem({ paneId: "a", visible: true, runtimeState: "live" })],
      budgetBytes: 1000,
      rasterBudgetBytes: 256 * 1024 * 1024,
      minLongEdgePx: 64,
      captureMissingOverviewPictures: false,
      resolver: undefined as
        ((pane: { paneId: string }) => OnirigiriPanePicture | null) | undefined,
    };
    pictures.configure(config);
    cleanups.push(
      pictures.start(root),
      pictures.register("a", content, readiness),
    );
    return {
      pictures,
      readiness,
      config,
      content,
      focus: (value: string) => {
        focused = value;
      },
      overview: (value: boolean) => {
        overview = value;
        pictures.activity();
      },
      move: (value: boolean) => {
        moving = value;
        pictures.activity();
      },
      bounds: (next: DOMRect) => {
        bounds = next;
      },
    };
  }

  const capture = vi.fn(
    async (request: CanvasRequest): Promise<CanvasPicture> => ({
      image: png(request.width, request.height),
      width: request.width,
      height: request.height,
    }),
  );

  it("keeps native input local while resize gestures still update live presentation", async () => {
    const f = fixture();
    f.pictures.configure({ ...f.config, liveContent: true });
    await vi.advanceTimersByTimeAsync(250);
    const presentation = f.pictures.getPresentation("a");
    const changed = vi.fn();
    cleanups.push(f.pictures.subscribe("a", changed));
    const input = document.createElement("input");
    f.content.append(input);
    input.value = "Keep this edit";
    for (const type of [
      "wheel",
      "scroll",
      "keydown",
      "pointerdown",
      "pointerup",
    ])
      input.dispatchEvent(new Event(type, { bubbles: true }));
    expect(changed).not.toHaveBeenCalled();
    expect(f.pictures.getPresentation("a")).toBe(presentation);
    expect(f.pictures.isInteractive()).toBe(true);
    expect(input.value).toBe("Keep this edit");

    const resize = document.createElement("button");
    resize.dataset.onirigiriSlot = "pane-resize-column";
    f.content.append(resize);
    resize.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(changed).toHaveBeenCalled();
    expect(f.pictures.isInteractive()).toBe(false);
    changed.mockClear();
    window.dispatchEvent(new Event("pointercancel"));
    expect(changed).toHaveBeenCalled();
    expect(f.pictures.isInteractive()).toBe(true);
  });

  it.each([
    ["resize", "scale", 2],
    ["scroll", "offsetLeft", 20],
    ["scroll", "offsetTop", 20],
  ] as const)(
    "tracks viewport eligibility through %s changes to %s without navigation reads",
    async (event, property, blockedValue) => {
      const values = { scale: 1, offsetLeft: 0, offsetTop: 0 };
      const measure = vi.fn();
      const viewport = new EventTarget();
      for (const key of ["scale", "offsetLeft", "offsetTop"] as const)
        Object.defineProperty(viewport, key, {
          get() {
            measure();
            return values[key];
          },
        });
      vi.stubGlobal("visualViewport", viewport);
      try {
        values[property] = blockedValue;
        const f = fixture(capture);
        await vi.advanceTimersByTimeAsync(250);
        expect(capture).not.toHaveBeenCalled();
        values[property] = property === "scale" ? 1 : 0;
        viewport.dispatchEvent(new Event(event));
        await vi.advanceTimersByTimeAsync(250);
        expect(f.pictures.get("a")?.width).toBe(200);
        measure.mockClear();
        f.move(true);
        expect(f.pictures.isLive("a")).toBe(false);
        f.move(false);
        await vi.advanceTimersByTimeAsync(250);
        expect(f.pictures.isLive("a")).toBe(true);
        expect(measure).not.toHaveBeenCalled();

        values[property] = blockedValue;
        viewport.dispatchEvent(new Event(event));
        expect(measure).toHaveBeenCalled();
        f.bounds(new DOMRect(40, 60, 300, 100));
        f.pictures.activity();
        await vi.advanceTimersByTimeAsync(350);
        expect(f.pictures.get("a")?.width).toBe(200);
        expect(capture).toHaveBeenCalledTimes(1);

        values[property] = property === "scale" ? 1 : 0;
        viewport.dispatchEvent(new Event(event));
        await vi.advanceTimersByTimeAsync(350);
        expect(f.pictures.get("a")?.width).toBe(300);
        expect(capture).toHaveBeenCalledTimes(2);
        for (const cleanup of cleanups.splice(0)) cleanup();
        measure.mockClear();
        viewport.dispatchEvent(new Event(event));
        expect(measure).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("defers capture across a held resize gesture and repeated layout updates", async () => {
    const f = fixture(capture);
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    for (let index = 0; index < 8; index++) {
      f.bounds(new DOMRect(40, 60, 200 + index * 10, 100));
      f.pictures.activity();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(capture).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(199);
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toMatchObject({ width: 270, height: 100 });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("waits for window resizing and overview wheel input to stop before warming", async () => {
    const f = fixture(capture);
    f.config.captureMissingOverviewPictures = true;
    f.pictures.configure(f.config);
    f.overview(true);
    for (const type of ["resize", "wheel", "resize", "wheel"]) {
      window.dispatchEvent(new Event(type));
      await vi.advanceTimersByTimeAsync(150);
      expect(f.pictures.getStatus().overviewPaneId).toBeNull();
      expect(capture).not.toHaveBeenCalled();
    }
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).not.toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("captures newly ready visible content before a slow neighboring preload", async () => {
    const preloadsDuringCapture: (string | null)[] = [];
    const f = fixture((request) => {
      preloadsDuringCapture.push(f.pictures.getStatus().preloadingPaneId);
      return capture(request);
    });
    const key = {};
    f.readiness.update(key, false, 0);
    const root = f.content.parentElement!;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1024, 768),
    );
    const neighbor = document.createElement("div");
    canvasMock.unpainted.add(neighbor);
    root.append(neighbor);
    vi.spyOn(neighbor, "getBoundingClientRect").mockReturnValue(
      new DOMRect(1040, 60, 200, 100),
    );
    const neighborReadiness = new PaneContentReadiness();
    neighborReadiness.update({}, false, 0);
    cleanups.push(f.pictures.register("b", neighbor, neighborReadiness));
    f.pictures.configure({
      ...f.config,
      items: [
        ...f.config.items,
        renderItem({ paneId: "b", visible: false, runtimeState: "hidden" }),
      ],
      preloadMarginPanes: 1,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.pictures.getStatus().preloadingPaneId).toBe("b");
    expect(capture).not.toHaveBeenCalled();
    f.readiness.update(key, true, 1);
    await vi.advanceTimersByTimeAsync(50);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, height: 100 });
    expect(preloadsDuringCapture).toEqual([null]);
  });

  it("captures generic DOM at its page bounds and retains pixels after live content eviction", async () => {
    const f = fixture(capture);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, height: 100 });
    const accepted = f.pictures.get("a");
    f.config.items = [];
    f.content.remove();
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(500);
    expect(f.pictures.get("a")!.image).toBe(accepted!.image);
    expect(f.pictures.get("a")!.capture).toBe(accepted!.capture);
    expect(accepted!.texture.dispose).not.toHaveBeenCalled();
    f.config.rasterBudgetBytes = 16 * 1024;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(150);
    expect(accepted!.texture.dispose).toHaveBeenCalledOnce();
    expect(f.pictures.get("a")!.image).toBe(accepted!.image);
    expect(f.pictures.getStatus().pictureBytes).toBe(44);
  });

  it("keeps uncapturable content native and accepts an explicit supplied picture", async () => {
    const f = fixture(capture);
    canvasMock.uncapturable.add(f.content);
    await vi.advanceTimersByTimeAsync(500);
    expect(capture).not.toHaveBeenCalled();
    expect(f.pictures.isDrawn("a")).toBe(true);
    expect(f.pictures.get("a")).toBeNull();
    expect(f.pictures.getStatus().rejected).toBe(0);
    const image = png();
    f.config.resolver = () => ({ image });
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")?.image).toBe(image);
    expect(capture).not.toHaveBeenCalled();
  });

  it("encodes a recorded frame once across native focus changes and refreshes after a new recording", async () => {
    const f = fixture(capture);
    await vi.advanceTimersByTimeAsync(150);
    const picture = f.pictures.get("a");
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(500);
    expect(capture).toHaveBeenCalledOnce();
    expect(f.pictures.get("a")).toBe(picture);
    f.move(true);
    canvasMock.frameVersion++;
    f.move(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(f.pictures.get("a")).not.toBe(picture);
  });

  it("retries a recorded frame when focus interrupts its first encoding", async () => {
    const reply = deferred<CanvasPicture>();
    const provider = vi.fn((request: CanvasRequest) =>
      provider.mock.calls.length === 1 ? reply.promise : capture(request),
    );
    const f = fixture(provider);
    await vi.advanceTimersByTimeAsync(100);
    expect(provider).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("blur"));
    reply.resolve({ image: png(), width: 200, height: 100 });
    await vi.advanceTimersByTimeAsync(500);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, height: 100 });
    expect(provider).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  function adjacentFixture() {
    const f = fixture(capture);
    f.readiness.update({}, false, 0);
    const root = f.content.parentElement!;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1024, 768),
    );
    const neighbor = document.createElement("div");
    canvasMock.unpainted.add(neighbor);
    root.append(neighbor);
    vi.spyOn(neighbor, "getBoundingClientRect").mockReturnValue(
      new DOMRect(1040, 60, 200, 100),
    );
    const readiness = new PaneContentReadiness();
    const key = {};
    readiness.update(key, false, 0);
    let mounted = true;
    cleanups.push(f.pictures.register("b", neighbor, readiness, () => mounted));
    f.pictures.configure({
      ...f.config,
      items: [
        ...f.config.items,
        renderItem({ paneId: "b", visible: false, runtimeState: "hidden" }),
      ],
      preloadMarginPanes: 1,
    });
    return {
      ...f,
      neighbor,
      mounted: (value: boolean) => {
        mounted = value;
      },
      ready: () => readiness.update(key, true, 1),
      loaded: () => neighbor.dispatchEvent(new Event("load")),
    };
  }
  it("does not preload every hidden application merely because a presentation policy exists", async () => {
    const f = adjacentFixture();
    const configuration = {
      ...f.config,
      presentation: "auto" as const,
      items: [
        ...f.config.items,
        renderItem({ paneId: "b", visible: false, runtimeState: "hidden" }),
      ],
      preloadMarginPanes: 0,
    };
    f.pictures.configure(configuration);
    f.ready();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    f.pictures.configure({ ...configuration, preloadAllPanePictures: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(capture).toHaveBeenCalledOnce();
  });

  it("does not remount excluded graphics for capture after navigation and resumes when mounted content becomes capturable", async () => {
    const f = adjacentFixture();
    canvasMock.uncapturable.add(f.neighbor);
    f.ready();
    const preloads: string[] = [];
    cleanups.push(
      f.pictures.subscribe("b", () => {
        if (f.pictures.isPreloading("b")) preloads.push("b");
      }),
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(preloads).toEqual([]);
    f.mounted(false);
    canvasMock.uncapturable.delete(f.neighbor);
    for (let index = 0; index < 3; index++) {
      f.move(true);
      await vi.advanceTimersByTimeAsync(150);
      f.move(false);
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(preloads).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
    f.mounted(true);
    f.loaded();
    await vi.advanceTimersByTimeAsync(350);
    expect(f.pictures.get("b")).not.toBeNull();
    expect(capture).toHaveBeenCalledOnce();
  });

  function frameCadence(initial: number) {
    let interval = initial;
    const start = Date.now();
    vi.spyOn(window.performance, "now").mockImplementation(
      () => Date.now() - start,
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(window.performance.now()), interval),
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) =>
      window.clearTimeout(id),
    );
    return (next: number) => {
      interval = next;
    };
  }

  it.each([false, true])(
    "preserves a drawn overview surface with a previously queued admission: %s",
    async (queued) => {
      const f = fixture(capture);
      f.move(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.pictures.isDrawn("a")).toBe(true);
      f.pictures.configure({
        ...f.config,
        preloadMarginPanes: 1,
        items: [
          renderItem({ paneId: "a", visible: false, runtimeState: "hidden" }),
        ],
      });
      if (queued) await vi.advanceTimersByTimeAsync(16);
      f.overview(true);
      f.pictures.configure({
        ...f.config,
        preloadMarginPanes: 1,
        items: [
          renderItem({
            paneId: "a",
            visible: true,
            runtimeState: "frozen",
            presentationMode: "overview",
          }),
        ],
      });
      await vi.advanceTimersByTimeAsync(600);
      expect(f.pictures.isDrawn("a")).toBe(true);
      expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
      expect(capture).not.toHaveBeenCalled();
    },
  );

  function preloadQueue(work: (paneId: string) => Promise<void>) {
    const candidates = ["first", "second", "third", "fourth"].map((paneId) => {
      const content = document.createElement("div");
      document.body.append(content);
      return {
        item: renderItem({ paneId, visible: false, runtimeState: "hidden" }),
        content,
        readiness: new PaneContentReadiness(),
        mounted: () => true,
        current: () => true,
      };
    });
    const warmups: { paneId: string; start: number; end: number }[] = [];
    const completed = new Set<string>();
    let active = 0;
    let maximumActive = 0;
    const controller = new PaneContentPreloader(
      (paneId) => {
        if (controller.paneId) {
          warmups.push({ paneId, start: Date.now(), end: 0 });
          maximumActive = Math.max(maximumActive, ++active);
        } else {
          warmups.at(-1)!.end = Date.now();
          active--;
        }
        controller.advance(
          candidates.filter((item) => !completed.has(item.item.paneId)),
        );
      },
      () => true,
      () => true,
      async (paneId) => {
        await work(paneId);
        completed.add(paneId);
        return true;
      },
      () => true,
    );
    cleanups.push(() => controller.advance([]));
    controller.advance(candidates);
    return { warmups, completed, maximumActive: () => maximumActive };
  }

  it("acquires healthy background panes promptly without overlapping temporary content", async () => {
    const queue = preloadQueue(
      () => new Promise((resolve) => setTimeout(resolve, 32)),
    );
    await vi.advanceTimersByTimeAsync(600);
    expect([...queue.completed]).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
    expect(queue.maximumActive()).toBe(1);
    for (let index = 1; index < queue.warmups.length; index++) {
      const gap = queue.warmups[index]!.start - queue.warmups[index - 1]!.end;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(40);
    }
  });

  it("keeps a prepared background pane pending while the shared capture slot is busy", async () => {
    const content = document.createElement("div");
    document.body.append(content);
    const candidate = {
      item: renderItem({ paneId: "waiting" }),
      content,
      readiness: new PaneContentReadiness(),
      mounted: () => true,
      current: () => true,
    };
    let available = false;
    const capture = vi.fn(async () => true);
    const controller = new PaneContentPreloader(
      () => controller.advance([candidate]),
      () => true,
      () => true,
      capture,
      () => available,
    );
    cleanups.push(() => controller.activity());
    controller.advance([candidate]);
    await vi.advanceTimersByTimeAsync(200);
    expect(controller.paneId).toBe("waiting");
    expect(capture).not.toHaveBeenCalled();
    available = true;
    controller.advance([candidate]);
    await vi.advanceTimersByTimeAsync(100);
    expect(capture).toHaveBeenCalledOnce();
    expect(controller.paneId).toBeNull();
  });

  it("reorders a queued warmup when navigation changes the nearest pane", async () => {
    const candidates = ["old-neighbor", "new-neighbor"].map((paneId) => ({
      item: renderItem({ paneId }),
      content: document.createElement("div"),
      readiness: new PaneContentReadiness(),
      mounted: () => false,
      current: () => true,
    }));
    const admitted: string[] = [];
    const controller = new PaneContentPreloader(
      (id) => {
        if (controller.paneId) admitted.push(id);
      },
      () => true,
      () => true,
      async () => false,
      () => true,
    );
    cleanups.push(() => controller.activity());
    controller.advance(candidates);
    await vi.advanceTimersByTimeAsync(32);
    controller.advance(candidates.toReversed());
    await vi.advanceTimersByTimeAsync(64);
    expect(admitted).toEqual(["new-neighbor"]);
  });

  it.each([false, true])(
    "captures the focused pane and surrounding ring first in overview: %s",
    async (overview) => {
      const acquired: string[] = [];
      const f = fixture((request) => {
        acquired.push(f.pictures.getStatus().inFlightPaneIds[0]!);
        return capture(request);
      });
      const positions = [
        { paneId: "far-west", x: 1580, y: 2000 },
        { paneId: "far-east", x: 2420, y: 2000 },
        { paneId: "diagonal", x: 2210, y: 1190 },
        { paneId: "north", x: 2000, y: 1190 },
        { paneId: "a", x: 2000, y: 2000 },
      ];
      const root = f.content.parentElement!;
      vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 1024, 900),
      );
      for (const { paneId, x, y } of positions) {
        if (paneId === "a") continue;
        const content = document.createElement("div");
        root.append(content);
        canvasMock.unpainted.add(content);
        vi.spyOn(content, "getBoundingClientRect").mockReturnValue(
          new DOMRect(x - 1600, y - 1900, 200, 800),
        );
        cleanups.push(
          f.pictures.register(paneId, content, new PaneContentReadiness()),
        );
      }
      f.overview(overview);
      f.pictures.configure({
        ...f.config,
        panes: createWorkspaceScene({
          panes: positions.map(({ paneId }) => ({
            paneId,
            title: paneId,
            surfaceKind: "test",
          })),
        }).scene.paneById,
        items: positions.map((position) =>
          renderItem({
            ...position,
            width: 200,
            height: 800,
            focused: position.paneId === "a",
            visible: overview || position.paneId === "a",
            presentationMode: overview ? "overview" : "normal",
            runtimeState: position.paneId === "a" ? "live" : "hidden",
          }),
        ),
        captureMissingOverviewPictures: overview,
        preloadAllPanePictures: true,
        preloadMarginPanes: 1,
      });
      for (let index = 0; index < positions.length; index++) {
        await vi.advanceTimersByTimeAsync(300);
        const id = f.pictures.getStatus().overviewPaneId;
        if (id) f.pictures.finishOverviewCapture(id);
      }
      expect(acquired).toEqual([
        "a",
        "north",
        "diagonal",
        "far-west",
        "far-east",
      ]);
    },
  );

  it("rechecks recent headroom before mounting another pane after a slow frame", async () => {
    const cadence = frameCadence(16);
    const queue = preloadQueue(async (paneId) => {
      await new Promise((resolve) => setTimeout(resolve, 32));
      if (paneId === "first") cadence(100);
    });
    await vi.advanceTimersByTimeAsync(230);
    expect([...queue.completed]).toEqual(["first"]);
    expect(queue.warmups.map((warmup) => warmup.paneId)).toEqual(["first"]);
    cadence(16);
    await vi.advanceTimersByTimeAsync(600);
    expect([...queue.completed]).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
    expect(queue.maximumActive()).toBe(1);
  });

  it("slows background acquisition after a heavy pane and recovers when frames stay healthy", async () => {
    const cadence = frameCadence(16);
    const queue = preloadQueue(async (paneId) => {
      if (paneId === "first") {
        cadence(50);
        await new Promise((resolve) => setTimeout(resolve, 150));
        cadence(16);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 32));
      }
    });
    await vi.advanceTimersByTimeAsync(1200);
    expect([...queue.completed]).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
    expect(queue.maximumActive()).toBe(1);
    const gaps = queue.warmups
      .slice(1)
      .map((warmup, index) => warmup.start - queue.warmups[index]!.end);
    expect(gaps[0]).toBeGreaterThan(200);
    expect(gaps[1]).toBeLessThan(gaps[0]!);
    expect(gaps[2]).toBeLessThan(gaps[1]!);
  });

  it("defers neighboring warming during navigation and warms once motion settles", async () => {
    frameCadence(16);
    const f = adjacentFixture();
    f.move(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    f.move(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.pictures.getStatus().preloadingPaneId).toBe("b");
    f.overview(true);
    f.ready();
    for (let step = 0; step < 10; step++) {
      f.pictures.activity();
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
    expect(capture).toHaveBeenCalledOnce();
    expect(f.pictures.get("b")).toMatchObject({ width: 200, height: 100 });
  });

  it("waits for frame headroom at rest and still progresses at a capped 30 Hz cadence", async () => {
    const cadence = frameCadence(100);
    const f = adjacentFixture();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    cadence(33);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.pictures.getStatus().preloadingPaneId).toBe("b");
    f.ready();
    await vi.advanceTimersByTimeAsync(250);
    expect(f.pictures.get("b")).not.toBeNull();
    expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
  });

  it("finishes a neighboring picture when content loads during its settling frames", async () => {
    const f = adjacentFixture();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.pictures.getStatus().preloadingPaneId).toBe("b");
    f.ready();
    await vi.advanceTimersByTimeAsync(16);
    f.loaded();
    await vi.advanceTimersByTimeAsync(16);
    expect(f.pictures.getStatus().preloadingPaneId).toBe("b");
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.pictures.get("b")).toMatchObject({ width: 200, height: 100 });
    expect(capture).toHaveBeenCalledOnce();
    expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
  });

  it("retries a neighboring picture invalidated during capture without remounting content", async () => {
    const pending = deferred<CanvasPicture>();
    capture.mockImplementationOnce(() => pending.promise);
    const f = adjacentFixture();
    const warmups: (string | null)[] = [];
    cleanups.push(
      f.pictures.subscribe("b", () => {
        const id = f.pictures.isPreloading("b") ? "b" : null;
        if (warmups.at(-1) !== id) warmups.push(id);
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    f.ready();
    await vi.advanceTimersByTimeAsync(100);
    expect(capture).toHaveBeenCalledOnce();
    f.loaded();
    pending.resolve({ image: png(), width: 200, height: 100 });
    await vi.advanceTimersByTimeAsync(200);
    expect(f.pictures.get("b")).toMatchObject({ width: 200, height: 100 });
    expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(warmups).toEqual(["b", null]);
  });

  it("cancels speculative warming through resizing and resumes after release", async () => {
    frameCadence(16);
    const f = adjacentFixture();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.pictures.getStatus().preloadingPaneId).toBe("b");
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    f.ready();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);
    expect(f.pictures.get("b")).toMatchObject({ width: 200, height: 100 });
    expect(capture).toHaveBeenCalledOnce();
    expect(f.pictures.getStatus().preloadingPaneId).toBeNull();
  });

  it("retains a picture acquired during a short settled visit before navigation resumes", async () => {
    const f = fixture(async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return capture(request);
    });
    f.move(true);
    await vi.advanceTimersByTimeAsync(125);
    f.move(false);
    await vi.advanceTimersByTimeAsync(50);
    const accepted = f.pictures.get("a");
    expect(accepted).not.toBeNull();
    f.move(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.pictures.get("a")).toBe(accepted);
    expect(f.pictures.getStatus()).toMatchObject({ accepted: 1, rejected: 0 });
  });

  it("keeps one capture in flight and retains its useful result across camera navigation", async () => {
    const reply = deferred<CanvasPicture>();
    const provider = vi.fn(() => reply.promise);
    const f = fixture(provider);
    await vi.advanceTimersByTimeAsync(100);
    f.move(true);
    f.move(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0]?.length).toBe(1);
    reply.resolve({
      image: png(),
      width: 200,
      height: 100,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, height: 100 });
    expect(window.createImageBitmap).not.toHaveBeenCalled();
  });

  it("waits for all readiness sources and keeps an accepted image during a document change", async () => {
    const f = fixture(capture);
    const a = {},
      b = {};
    f.readiness.update(a, false, 1);
    f.readiness.update(b, false, 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.pictures.get("a")).toBeNull();
    f.readiness.update(a, true, 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.pictures.get("a")).toBeNull();
    f.readiness.update(b, true, 1);
    await vi.advanceTimersByTimeAsync(150);
    const accepted = f.pictures.get("a");
    expect(accepted).not.toBeNull();
    f.readiness.update(a, false, 2);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toBe(accepted);
  });

  it("rejects a reply after readiness revision changes before decode", async () => {
    const reply = deferred<CanvasPicture>();
    const f = fixture(() => reply.promise);
    await vi.advanceTimersByTimeAsync(100);
    f.readiness.update({}, false, "new-document");
    reply.resolve({
      image: png(),
      width: 200,
      height: 100,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.pictures.get("a")).toBeNull();
    expect(window.createImageBitmap).not.toHaveBeenCalled();
  });

  it("keeps old pixels when a capture is oversized and exposes acquisition failure", async () => {
    const f = fixture(capture);
    await vi.advanceTimersByTimeAsync(150);
    const accepted = f.pictures.get("a");
    expect(accepted).not.toBeNull();
    canvasMock.capture = async () => {
      throw new Error("Pane canvas exceeds the encoded picture budget");
    };
    f.pictures.configure(f.config);
    f.pictures.refresh();
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toBe(accepted);
    expect(f.pictures.getStatus()).toMatchObject({ state: "unavailable" });
  });

  it("shares supplied and captured ownership, preserves withdrawn sources, and releases removed panes", async () => {
    const f = fixture();
    const image = png();
    f.config.resolver = () => ({ image });
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(150);
    const accepted = f.pictures.get("a");
    expect(accepted).not.toBeNull();
    f.config.resolver = undefined;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toBe(accepted);
    f.config.panes = new Map();
    f.pictures.configure(f.config);
    expect(f.pictures.getStatus().pictures).toHaveLength(0);
    expect(accepted!.texture.dispose).toHaveBeenCalledOnce();
  });

  it("protects visible pictures and refuses a replacement without simultaneous capacity", async () => {
    const f = fixture(capture);
    f.config.budgetBytes = 60;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(150);
    const accepted = f.pictures.get("a");
    expect(accepted).not.toBeNull();
    f.pictures.activity();
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toBe(accepted);
    expect(f.pictures.getStatus().pictureBytes).toBeLessThanOrEqual(60);
  });

  it.each([
    ["encoded", 200, 100, 1500],
    ["raster", 400, 400, 20],
  ] as const)(
    "rejects impossible %s admission without discarding retained pictures",
    async (_budget, width, height, extra) => {
      const f = fixture();
      const images = new Map([
        ["a", png()],
        ["b", png()],
        ["c", png()],
      ]);
      f.config.panes = new Map([
        ...f.config.panes,
        ["c", { ...f.config.panes.get("b")!, paneId: "c" }],
      ]);
      f.config.items = [
        renderItem({ paneId: "a", x: 0, visible: true }),
        renderItem({ paneId: "b", x: 4000, visible: false }),
        renderItem({ paneId: "c", x: 8000, visible: false }),
      ];
      f.config.resolver = (pane) => ({ image: images.get(pane.paneId)! });
      f.config.rasterBudgetBytes = 110000;
      f.pictures.configure(f.config);
      await vi.advanceTimersByTimeAsync(300);
      const retained = ["a", "b", "c"].map((id) => f.pictures.get(id));
      expect(retained.every(Boolean)).toBe(true);
      images.set("b", png(width, height, extra));
      f.pictures.activity();
      await vi.advanceTimersByTimeAsync(300);
      for (const [index, id] of ["a", "b", "c"].entries())
        expect(f.pictures.get(id)).toBe(retained[index]);
      expect(f.pictures.getStatus().accepted).toBe(3);
    },
  );

  it("retains compressed originals while bounding prepared textures and restores without capture", async () => {
    const f = fixture();
    const images = new Map([
      ["a", png()],
      ["b", png()],
    ]);
    f.config.items = [
      renderItem({ paneId: "a", x: 0, visible: true }),
      renderItem({ paneId: "b", x: 4000, visible: false }),
    ];
    f.config.resolver = (pane) => ({ image: images.get(pane.paneId)! });
    f.config.rasterBudgetBytes = 100000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pictures.get("b")!.image).toBe(images.get("b"));
    expect(f.pictures.get("a")).toMatchObject({
      width: 200,
      height: 100,
      pixelated: false,
    });
    expect(f.pictures.get("b")).toMatchObject({
      width: 64,
      height: 32,
      pixelated: true,
    });
    expect(f.pictures.getStatus().pictureBytes).toBe(88);
    expect(f.pictures.getStatus().pictureRasterBytes).toBeLessThanOrEqual(
      100000,
    );
    const revision = f.pictures.get("b")!.revision;
    f.move(true);
    f.focus("b");
    f.config.items = [
      renderItem({ paneId: "b", x: 0, visible: true }),
      renderItem({ paneId: "a", x: 4000, visible: false }),
    ];
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pictures.get("b")).toMatchObject({
      width: 200,
      height: 100,
      pixelated: false,
      revision,
    });
    expect(f.pictures.get("b")!.image).toBe(images.get("b"));
    expect(f.pictures.getStatus().accepted).toBe(2);
    expect(f.pictures.getStatus().pictureRasterBytes).toBeLessThanOrEqual(
      100000,
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it("retains sharp textures outside the focus neighborhood until memory is needed", async () => {
    const f = fixture();
    const images = new Map([
      ["a", png()],
      ["b", png()],
    ]);
    f.config.items = [
      renderItem({ paneId: "a", x: 0, visible: true }),
      renderItem({ paneId: "b", x: 4000, visible: false }),
    ];
    f.config.resolver = (pane) => ({ image: images.get(pane.paneId)! });
    f.config.rasterBudgetBytes = 200000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, pixelated: false });
    f.focus("b");
    f.config.items = [
      renderItem({ paneId: "b", x: 0, visible: true }),
      renderItem({ paneId: "a", x: 4000, visible: false }),
    ];
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    for (const id of ["a", "b"])
      expect(f.pictures.get(id)).toMatchObject({
        width: 200,
        height: 100,
        pixelated: false,
      });
    f.overview(true);
    f.config.items = f.config.items.map((item) => ({
      ...item,
      presentationMode: "overview",
    }));
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, pixelated: false });
    f.config.rasterBudgetBytes = 100000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pictures.get("a")).toMatchObject({ width: 64, pixelated: true });
    expect(f.pictures.get("b")).toMatchObject({ width: 200, pixelated: false });
    expect(f.pictures.getStatus().pictureRasterBytes).toBeLessThanOrEqual(
      100000,
    );
    expect(f.pictures.get("a")!.image).toBe(images.get("a"));
    expect(f.pictures.getStatus().accepted).toBe(2);
    expect(capture).not.toHaveBeenCalled();
  });

  it("admits a mosaic instead of evicting retained previews for a full-size capture", async () => {
    const f = fixture();
    const images = new Map([
      ["a", png()],
      ["b", png()],
    ]);
    f.config.items = [];
    f.config.resolver = (pane) => ({ image: images.get(pane.paneId)! });
    f.config.rasterBudgetBytes = 20000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(
      f.pictures.getStatus().pictures.map((picture) => picture.paneId),
    ).toEqual(["a", "b"]);
    expect(f.pictures.get("a")).toMatchObject({
      width: 64,
      height: 32,
      pixelated: true,
    });
    expect(f.pictures.get("b")).toMatchObject({
      width: 64,
      height: 32,
      pixelated: true,
    });
    expect(f.pictures.getStatus().pictureRasterBytes).toBe(16384);
  });

  it("restores visible texture detail after increasing the decoded memory budget", async () => {
    const f = fixture(capture);
    f.config.rasterBudgetBytes = 20000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pictures.get("a")).toMatchObject({
      width: 64,
      height: 32,
      pixelated: true,
    });
    f.config.rasterBudgetBytes = 100000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pictures.get("a")).toMatchObject({
      width: 200,
      height: 100,
      pixelated: false,
    });
    expect(f.pictures.getStatus().pictureRasterBytes).toBeLessThanOrEqual(
      100000,
    );
  });

  it("disposes a late detail preparation after its pane is removed", async () => {
    const f = fixture();
    const original = png();
    f.config.resolver = (pane) =>
      pane.paneId === "a" ? { image: original } : null;
    f.config.rasterBudgetBytes = 20000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    const preview = f.pictures.get("a")!.texture;
    const pending =
      deferred<Awaited<ReturnType<typeof preparePanePictureTexture>>>();
    const late = {
      width: 200,
      height: 100,
      present: vi.fn(),
      dispose: vi.fn(),
    };
    vi.mocked(preparePanePictureTexture).mockImplementationOnce(
      () => pending.promise,
    );
    f.config.rasterBudgetBytes = 100000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.pictures.get("a")!.texture).toBe(preview);
    f.config.panes = new Map();
    f.pictures.configure(f.config);
    pending.resolve(late);
    await vi.advanceTimersByTimeAsync(300);
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(f.pictures.get("a")).toBeNull();
    expect(f.pictures.getStatus()).toMatchObject({
      pictureBytes: 0,
      pictureRasterBytes: 0,
    });
  });

  it("does not repeatedly encode originals when preparing smaller textures", async () => {
    const f = fixture();
    const images = new Map([
      ["a", png()],
      ["b", png()],
    ]);
    f.config.items = [];
    f.config.resolver = (pane) => ({ image: images.get(pane.paneId)! });
    f.config.rasterBudgetBytes = 20000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pictures.getStatus().pictureRasterBytes).toBe(16384);
    expect(f.pictures.getStatus().pictureBytes).toBe(88);
    expect(f.pictures.get("a")!.image).toBe(images.get("a"));
    expect(f.pictures.get("b")!.image).toBe(images.get("b"));
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  });

  it("keeps visible pictures sharp and restores detail after a reduced picture is revisited", async () => {
    const f = fixture(capture);
    await vi.advanceTimersByTimeAsync(150);
    f.config.rasterBudgetBytes = 20000;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, pixelated: false });
    f.config.items = [];
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toMatchObject({ width: 64, pixelated: true });
    f.config.rasterBudgetBytes = 200000;
    f.config.items = [
      renderItem({ paneId: "a", visible: true, runtimeState: "live" }),
    ];
    canvasMock.frameVersion++;
    f.pictures.configure(f.config);
    f.pictures.activity();
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, pixelated: false });
  });

  it("waits for overview readiness and image loading, captures serially, and preserves focus", async () => {
    const f = fixture(capture);
    f.overview(true);
    f.config.items = ["a", "b"].map((paneId) =>
      renderItem({
        paneId,
        visible: true,
        placeholderOnly: true,
        presentationMode: "overview",
        runtimeState: "frozen",
      }),
    );
    f.config.captureMissingOverviewPictures = true;
    const b = document.createElement("div");
    f.content.parentElement!.append(b);
    vi.spyOn(b, "getBoundingClientRect").mockReturnValue(
      new DOMRect(300, 60, 200, 100),
    );
    cleanups.push(f.pictures.register("b", b, new PaneContentReadiness()));
    const source = {};
    f.readiness.update(source, false, 1);
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pictures.getStatus().overviewPaneId).toBe("a");
    expect(capture).not.toHaveBeenCalled();
    f.readiness.update(source, true, 1);
    await vi.advanceTimersByTimeAsync(150);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(f.pictures.get("a")).not.toBeNull();
    expect(f.pictures.get("b")).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(capture).toHaveBeenCalledTimes(1);
    f.pictures.finishOverviewCapture("a");
    await vi.advanceTimersByTimeAsync(150);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(f.pictures.get("b")).not.toBeNull();
    f.pictures.finishOverviewCapture("b");
    await vi.advanceTimersByTimeAsync(500);
    expect(f.pictures.getStatus().overviewPaneId).toBeNull();
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("leaves overview cold by default and cancels its warm capture when overview closes", async () => {
    const reply = deferred<CanvasPicture>();
    const provider = vi.fn(() => reply.promise);
    const f = fixture(provider);
    f.overview(true);
    f.config.items = [
      renderItem({
        paneId: "a",
        visible: true,
        placeholderOnly: true,
        presentationMode: "overview",
        runtimeState: "frozen",
      }),
    ];
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(150);
    expect(provider).not.toHaveBeenCalled();
    f.config.captureMissingOverviewPictures = true;
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(150);
    expect(provider).toHaveBeenCalledTimes(1);
    f.overview(false);
    expect(f.pictures.getStatus().overviewPaneId).toBeNull();
    reply.resolve(
      await capture({
        width: 200,
        height: 100,
        stage: true,
        signal: new AbortController().signal,
      }),
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toBeNull();
    expect(window.createImageBitmap).not.toHaveBeenCalled();
  });

  it("skips an overview pane that never becomes ready and continues with the next pane", async () => {
    const f = fixture(capture);
    f.overview(true);
    f.config.captureMissingOverviewPictures = true;
    f.config.items = ["a", "b"].map((paneId) =>
      renderItem({
        paneId,
        visible: true,
        placeholderOnly: true,
        presentationMode: "overview",
        runtimeState: "frozen",
      }),
    );
    f.readiness.update({}, false, 1);
    const b = document.createElement("div");
    f.content.parentElement!.append(b);
    vi.spyOn(b, "getBoundingClientRect").mockReturnValue(
      new DOMRect(300, 60, 200, 100),
    );
    cleanups.push(f.pictures.register("b", b, new PaneContentReadiness()));
    f.pictures.configure(f.config);
    await vi.advanceTimersByTimeAsync(10500);
    expect(f.pictures.get("a")).toBeNull();
    expect(f.pictures.get("b")).not.toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("captures complete pane content even when its screen rectangle is clipped or occluded", async () => {
    const provider = vi.fn(capture);
    const f = fixture(provider);
    f.bounds(new DOMRect(-20, 60, 200, 100));
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, height: 100 });
    f.bounds(new DOMRect(40, 60, 200, 100));
    vi.mocked(document.elementFromPoint).mockReturnValue(document.body);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.pictures.get("a")).toMatchObject({ width: 200, height: 100 });
  });
});
