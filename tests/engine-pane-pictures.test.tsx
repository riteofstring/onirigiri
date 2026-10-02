// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import { useOnirigiriPaneContentReady } from "../src/panes/pane-content-readiness";
import type { OnirigiriWorkspaceHandle } from "../src/workspace/onirigiri-workspace-types";
import { stubOnirigiriWorkspaceBrowserGlobals } from "./onirigiri-workspace-test-support";

const canvasMock = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("../src/pictures/pane-picture-texture", () => ({
  preparePanePictureTexture: vi.fn(
    async (_document, _device, _image, size) => ({
      ...size,
      present: vi.fn((canvas: HTMLCanvasElement) => {
        canvas.width = size.width;
        canvas.height = size.height;
        return () => {
          canvas.width = canvas.height = 1;
        };
      }),
      dispose: vi.fn(),
    }),
  ),
}));
vi.mock("../src/pictures/pane-picture-canvas", () => ({
  createPaneCanvasDevice: async () => ({ destroy: vi.fn() }),
  PaneCanvasSurface: class {
    frameVersion = 0;
    constructor(
      _canvas: HTMLCanvasElement,
      private content: HTMLElement,
      _device: unknown,
      private callbacks: { canDraw(): boolean; drawn(ready: boolean): void },
    ) {
      queueMicrotask(() => this.requestPaint());
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
    requestPaint() {
      queueMicrotask(() => {
        if (this.callbacks.canDraw()) this.callbacks.drawn(true);
      });
    }
    dispose() {}
    clear() {}
    setResizing() {}
    hasVideo() {
      return false;
    }
    canCapture() {
      return true;
    }
    hasCurrentFrame() {
      return true;
    }
    capture() {
      return canvasMock.capture({
        width: this.content.offsetWidth,
        height: this.content.offsetHeight,
      });
    }
  },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  vi.useFakeTimers();
  canvasMock.capture
    .mockReset()
    .mockRejectedValue(new Error("Test surface unavailable"));
  stubOnirigiriWorkspaceBrowserGlobals();
  frames = new Map();
  let sequence = 0;
  vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.mocked(cancelAnimationFrame).mockImplementation((id) => {
    frames.delete(id);
  });
  Object.defineProperty(window.URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:retained-picture"),
  });
  Object.defineProperty(window.URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window, "createImageBitmap", {
    configurable: true,
    value: vi.fn(async (blob: Blob) => {
      const header = new DataView(await blob.slice(0, 24).arrayBuffer());
      return {
        width: header.getUint32(16),
        height: header.getUint32(20),
        close() {},
      };
    }),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function advanceFrames(duration: number) {
  for (let elapsed = 0; elapsed < duration; elapsed += 16) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(performance.now());
    });
  }
}

async function settle() {
  await act(async () => {
    let time = 0;
    for (let i = 0; i < 240 && frames.size; i++) {
      const callbacks = [...frames.values()];
      frames.clear();
      time += 16.67;
      for (const callback of callbacks) callback(time);
    }
  });
}

it("retains a supplied picture in the engine after content eviction and shows it on a cold overview visit", async () => {
  const image = png(10, 10);
  const handle = createRef<OnirigiriWorkspaceHandle>();
  await act(async () =>
    root.render(
      <OnirigiriWorkspace
        initialPanes={Array.from({ length: 16 }, (_, index) => ({
          paneId: `pane-${index}`,
          columnId: `column-${index}`,
          slotIndex: index,
          columnWidth: { unit: "px" as const, value: 520 },
          surfaceKind: "custom",
          title: `Pane ${index}`,
        }))}
        getPanePicture={(pane) => (pane.paneId === "pane-0" ? { image } : null)}
        ref={handle}
        retainedAreaBudgetViewports={0}
        styles={{
          "pane-picture": { outline: "2px solid purple" },
          "pane-placeholder": { color: "purple" },
        }}
        renderPane={(pane) => (
          <input
            aria-label={`${pane.title} content`}
            defaultValue="Retained form"
          />
        )}
      />,
    ),
  );
  await settle();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  const pane = container.querySelector('[data-onirigiri-pane-id="pane-0"]')!;
  const retainedImage = pane.querySelector(
    '[data-onirigiri-slot="pane-picture"]',
  );
  expect(retainedImage).not.toBeNull();
  const input = pane.querySelector("input")!;
  input.value = "Typed value";
  await act(async () => {
    handle.current!.toggleOverview();
  });
  await settle();
  expect(pane.querySelector("input")).toBe(input);
  expect(input.value).toBe("Typed value");
  expect(pane.querySelector('[data-onirigiri-slot="pane-picture"]')).toBe(
    retainedImage,
  );
  await act(async () => {
    handle.current!.toggleOverview();
  });
  await settle();
  await act(async () => {
    handle.current!.focusPane("pane-14");
  });
  await settle();
  expect(pane.querySelector("input")).toBeNull();
  await act(async () => {
    handle.current!.toggleOverview();
  });
  await settle();
  await act(async () => {
    handle.current!.focusPane("pane-0");
  });
  await settle();
  const picture = pane.querySelector<HTMLImageElement>(
    '[data-onirigiri-slot="pane-picture"]',
  );
  expect(picture).not.toBeNull();
  expect(picture).toBe(retainedImage);
  expect(picture).toBeInstanceOf(HTMLCanvasElement);
  expect(picture!.style.outline).toBe("2px solid purple");
  expect(pane.querySelector("input")).toBeNull();
});

function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(44);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new NodeBlob([bytes], { type: "image/png" }) as Blob;
}

it("temporarily adds only the warming pane beyond the retained content budget before readiness", async () => {
  const handle = createRef<OnirigiriWorkspaceHandle>();
  const image = png(10, 10);
  const initialPanes = Array.from({ length: 16 }, (_, index) => ({
    paneId: `pane-${index}`,
    columnId: `column-${index}`,
    slotIndex: index,
    columnWidth: { unit: "px" as const, value: 520 },
    surfaceKind: "custom",
    title: `Pane ${index}`,
  }));
  const render = (margin: number) =>
    act(async () =>
      root.render(
        <OnirigiriWorkspace
          ref={handle}
          initialPanes={initialPanes}
          retainedAreaBudgetViewports={1}
          preloadMarginPanes={margin}
          getPanePicture={(pane) =>
            pane.paneId === "pane-14" ? null : { image }
          }
          renderPane={(pane) => (
            <PendingPaneContent ready={pane.paneId !== "pane-14"} />
          )}
        />,
      ),
    );
  await render(0);
  await settle();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  await act(async () => handle.current!.toggleOverview());
  await settle();
  await act(async () => handle.current!.focusPane("pane-14"));
  await settle();
  const pictureCount = handle.current!.getCaptureStatus().pictures.length;
  expect(pictureCount).toBe(15);
  const cold = container.querySelector('[data-onirigiri-pane-id="pane-14"]')!;
  expect(cold.querySelector("input")).toBeNull();
  await render(1);
  await advanceFrames(150);
  expect(handle.current!.getCaptureStatus().preloadingPaneId).toBe("pane-14");
  expect(cold.querySelector("input")).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  const mountedArea = [
    ...container.querySelectorAll<HTMLInputElement>("input"),
  ].reduce((area, input) => {
    const pane = input.closest<HTMLElement>('[data-onirigiri-slot="pane"]')!;
    return (
      area +
      Number.parseFloat(pane.style.width) * Number.parseFloat(pane.style.height)
    );
  }, 0);
  const coldWidth = Number.parseFloat((cold as HTMLElement).style.width);
  const coldHeight = Number.parseFloat((cold as HTMLElement).style.height);
  expect(mountedArea - coldWidth * coldHeight).toBeLessThanOrEqual(1200 * 900);
  expect(
    container.querySelectorAll('[data-onirigiri-preloading="true"]'),
  ).toHaveLength(1);
  expect(handle.current!.getCaptureStatus().pictures).toHaveLength(
    pictureCount,
  );
});

function PendingPaneContent({ ready }: { ready: boolean }) {
  useOnirigiriPaneContentReady(ready);
  return <input defaultValue="Retained content" />;
}

it("captures ordinary consumer content through the engine and recovers from acquisition failure", async () => {
  const capture = canvasMock.capture.mockImplementation(
    async (request: { width: number; height: number }) => ({
      image: png(request.width, request.height),
      width: request.width,
      height: request.height,
    }),
  );
  const handle = createRef<OnirigiriWorkspaceHandle>();
  const render = (fit: "contain" | "cover") =>
    root.render(
      <OnirigiriWorkspace
        ref={handle}
        paneDefaults={{ content: { fit, aspectRatio: 16 / 9 } }}
        initialPanes={[
          { paneId: "ordinary", title: "Ordinary", surfaceKind: "custom" },
        ]}
        renderPane={() => <article>Consumer-owned content</article>}
      />,
    );
  await act(async () => render("contain"));
  await settle();
  const content = container.querySelector<HTMLElement>(
    '[data-onirigiri-slot="pane-live-content"]',
  )!;
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue(
    new DOMRect(40, 60, 200, 100),
  );
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => content),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
  ) {
    callback(png(this.width, this.height));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(capture).toHaveBeenCalledOnce();
  expect(handle.current!.getCaptureStatus()).toMatchObject({
    state: "idle",
    accepted: 1,
    pictures: [{ paneId: "ordinary", width: 200, height: 100 }],
  });
  const consumer = content.querySelector("article");
  await act(async () => render("cover"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(content.querySelector("article")).toBe(consumer);
  expect(handle.current!.getCaptureStatus().accepted).toBe(2);
  const accepted = handle.current!.getCaptureStatus().pictures;
  capture.mockRejectedValueOnce(new Error("GPU readback failed"));
  await act(async () => {
    handle.current!.refreshPanePictures();
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(handle.current!.getCaptureStatus()).toMatchObject({
    state: "unavailable",
    reason: "GPU readback failed",
    pictures: accepted,
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(handle.current!.getCaptureStatus()).toMatchObject({
    state: "idle",
    reason: null,
    accepted: 3,
  });
});

it("temporarily renders only one cold overview pane through the public option", async () => {
  const handle = createRef<OnirigiriWorkspaceHandle>();
  const initialPanes = Array.from({ length: 16 }, (_, index) => ({
    paneId: `pane-${index}`,
    columnId: `column-${index}`,
    slotIndex: index,
    columnWidth: { unit: "px" as const, value: 520 },
    surfaceKind: "custom",
    title: `Pane ${index}`,
  }));
  const capture = canvasMock.capture.mockImplementation(
    async (request: { width: number; height: number }) => ({
      image: png(request.width, request.height),
      width: request.width,
      height: request.height,
    }),
  );
  await act(async () =>
    root.render(
      <OnirigiriWorkspace
        ref={handle}
        initialPanes={initialPanes}
        retainedAreaBudgetViewports={0}
        captureMissingOverviewPictures
        renderPane={(pane, state) => (
          <input aria-label={pane.title} data-runtime={state.runtimeState} />
        )}
      />,
    ),
  );
  await settle();
  await act(async () => handle.current!.toggleOverview());
  await settle();
  await act(async () => handle.current!.focusPane("pane-14"));
  await settle();
  const focusBefore = handle.current!.getSnapshot().focusedPaneId;
  for (const host of container.querySelectorAll<HTMLElement>(
    '[data-onirigiri-slot="pane-live-content"]',
  ))
    Object.defineProperty(host, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(-1000, 60, 200, 100),
    });
  const cold = container.querySelector('[data-onirigiri-pane-id="pane-14"]')!;
  expect(cold.querySelector("input")).toBeNull();
  const content = cold.querySelector<HTMLElement>(
    '[data-onirigiri-slot="pane-live-content"]',
  )!;
  Object.defineProperty(content, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(40, 60, 200, 100),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => content.parentElement,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
  ) {
    callback(png(this.width, this.height));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(
    container.querySelectorAll('[data-onirigiri-overview-capture="true"]'),
  ).toHaveLength(1);
  expect(cold.querySelector("input")?.dataset.runtime).toBe("live");
  expect(content.hasAttribute("inert")).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  const picture = cold.querySelector('[data-onirigiri-slot="pane-picture"]');
  expect(picture).not.toBeNull();
  expect(cold.querySelector("input")).not.toBeNull();
  await act(async () => {
    await settle();
  });
  expect(cold.querySelector("input")).toBeNull();
  expect(cold.querySelector('[data-onirigiri-slot="pane-picture"]')).toBe(
    picture,
  );
  expect(handle.current!.getSnapshot().focusedPaneId).toBe(focusBefore);
  expect(handle.current!.getSnapshot().presentationMode).toBe("overview");
  expect(capture).toHaveBeenCalledTimes(1);
});

it("unmounts temporary neighboring content when its picture capture fails", async () => {
  const handle = createRef<OnirigiriWorkspaceHandle>();
  const initialPanes = Array.from({ length: 16 }, (_, index) => ({
    paneId: `pane-${index}`,
    columnId: `column-${index}`,
    slotIndex: index,
    columnWidth: { unit: "px" as const, value: 520 },
    surfaceKind: "custom",
    title: `Pane ${index}`,
  }));
  const render = async (budget: number) =>
    act(async () =>
      root.render(
        <OnirigiriWorkspace
          ref={handle}
          initialPanes={initialPanes}
          retainedAreaBudgetViewports={budget}
          preloadMarginPanes={budget === 1 ? 0 : 1}
          renderPane={(pane, state) => (
            <input aria-label={pane.title} data-runtime={state.runtimeState} />
          )}
        />,
      ),
    );
  await render(1);
  await settle();
  await act(async () => handle.current!.toggleOverview());
  await settle();
  const focused = handle.current!.getSnapshot().focusedPaneId;
  for (const host of container.querySelectorAll<HTMLElement>(
    '[data-onirigiri-slot="pane"]',
  ))
    Object.defineProperty(host, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(-10000, 40, 200, 100),
    });
  const cold = container.querySelector('[data-onirigiri-pane-id="pane-14"]')!;
  const outside = container.querySelector(
    '[data-onirigiri-pane-id="pane-15"]',
  )!;
  const content = cold.querySelector<HTMLElement>(
    '[data-onirigiri-slot="pane-live-content"]',
  )!;
  Object.defineProperty(cold, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(1220, 40, 200, 100),
  });
  Object.defineProperty(outside, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(1420, 40, 200, 100),
  });
  expect(cold.querySelector("input")).toBeNull();
  let rejectCapture!: (error: Error) => void;
  canvasMock.capture.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectCapture = reject;
      }),
  );
  await render(8);
  await advanceFrames(150);
  expect(
    container.querySelectorAll('[data-onirigiri-preloading="true"]'),
  ).toHaveLength(1);
  const input = cold.querySelector<HTMLInputElement>("input")!;
  expect(input.dataset.runtime).toBe("live");
  expect(content.inert).toBe(true);
  input.value = "Initialized offscreen";
  await act(async () => {
    rejectCapture(new Error("Capture unavailable"));
  });
  await settle();
  expect(cold.querySelector("input")).toBeNull();
  expect(input.isConnected).toBe(false);
  expect(outside.querySelector("input")).toBeNull();
  expect(handle.current!.getCaptureStatus()).toMatchObject({
    preloadingPaneId: null,
    pictures: [],
  });
  expect(handle.current!.getSnapshot().focusedPaneId).toBe(focused);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(
    container.querySelectorAll('[data-onirigiri-preloading="true"]'),
  ).toHaveLength(0);
  expect(cold.querySelector("input")).toBeNull();
});
