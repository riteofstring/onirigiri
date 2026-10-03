import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaygroundFrame } from "../shared/playground-frame";

describe("shared playground display frame rate", () => {
  let animationFrames: ManualAnimationFrameHost;
  let mountedFrames: MountedFrame[];
  let originalVisibilityState: PropertyDescriptor | undefined;
  let visibilityState: "hidden" | "visible";

  beforeEach(() => {
    animationFrames = new ManualAnimationFrameHost();
    mountedFrames = [];
    visibilityState = "visible";
    originalVisibilityState = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      animationFrames.requestAnimationFrame,
    );
    vi.stubGlobal("cancelAnimationFrame", animationFrames.cancelAnimationFrame);
  });

  afterEach(async () => {
    for (const mounted of mountedFrames.splice(0)) {
      await act(async () => mounted.root.unmount());
      mounted.container.remove();
    }
    if (originalVisibilityState) {
      Object.defineProperty(
        document,
        "visibilityState",
        originalVisibilityState,
      );
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
    vi.unstubAllGlobals();
  });

  it("samples browser animation-frame cadence over a restrained one-second window", async () => {
    const mounted = await mountFrameRate();
    const frameRate = requiredFrameRate(mounted.container);

    await flushAt60Hz(0, 59);
    expect(frameRate.textContent).toBe("— FPS");

    await flushAt60Hz(60, 60);
    expect(frameRate.textContent).toBe("60 FPS");
    expect(frameRate.getAttribute("aria-label")).toBe(
      "Browser display frame rate: 60 frames per second",
    );
  });

  it("cancels sampling while hidden and resumes with one fresh browser loop", async () => {
    const mounted = await mountFrameRate();

    expect(animationFrames.pendingFrameCount()).toBe(1);
    await setDocumentVisibility("hidden");
    expect(animationFrames.pendingFrameCount()).toBe(0);

    await setDocumentVisibility("visible");
    expect(animationFrames.pendingFrameCount()).toBe(1);
    await setDocumentVisibility("visible");
    expect(animationFrames.pendingFrameCount()).toBe(1);

    await flushAt60Hz(0, 60);
    expect(requiredFrameRate(mounted.container).textContent).toBe("60 FPS");
  });

  it("cancels its sole pending browser frame when unmounted", async () => {
    const mounted = await mountFrameRate();

    expect(animationFrames.pendingFrameCount()).toBe(1);
    await unmountFrameRate(mounted);
    expect(animationFrames.pendingFrameCount()).toBe(0);
  });

  it("presents non-live, labeled telemetry beside rather than inside status updates", async () => {
    const mounted = await mountFrameRate();
    const frameRate = requiredFrameRate(mounted.container);
    const status = mounted.container.querySelector(
      '[role="status"][aria-label="Playground status"]',
    );

    expect(frameRate.tagName).toBe("OUTPUT");
    expect(frameRate.textContent).toBe("— FPS");
    expect(frameRate.getAttribute("aria-label")).toBe(
      "Browser display frame rate: sampling",
    );
    expect(frameRate.getAttribute("aria-live")).toBe("off");
    expect(frameRate.closest(".playground-status-row")).not.toBeNull();
    expect(status?.contains(frameRate)).toBe(false);
    expect(frameRate.closest(".playground-navigation")).toBeNull();
  });

  async function flushAt60Hz(
    firstFrame: number,
    lastFrame: number,
  ): Promise<void> {
    await act(async () => {
      for (let frame = firstFrame; frame <= lastFrame; frame += 1) {
        animationFrames.flush((frame * 1_000) / 60);
      }
    });
  }

  async function setDocumentVisibility(
    nextVisibilityState: "hidden" | "visible",
  ): Promise<void> {
    visibilityState = nextVisibilityState;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  async function mountFrameRate(): Promise<MountedFrame> {
    const container = document.createElement("div");
    document.body.append(container);
    const mounted = { container, root: createRoot(container) };
    mountedFrames.push(mounted);
    await act(async () => {
      mounted.root.render(
        <PlaygroundFrame
          actions={null}
          guide={null}
          model="2d"
          onResizePanes={() => undefined}
          onToggleOverview={() => undefined}
          presentationMode="normal"
          status="Ready"
          subtitle="Test playground"
          title="Onirigiri test"
          workspaceLabel="Test workspace"
        >
          <div>Workspace</div>
        </PlaygroundFrame>,
      );
    });
    return mounted;
  }

  async function unmountFrameRate(mounted: MountedFrame): Promise<void> {
    const index = mountedFrames.indexOf(mounted);
    if (index >= 0) {
      mountedFrames.splice(index, 1);
    }
    await act(async () => mounted.root.unmount());
    mounted.container.remove();
  }
});

interface MountedFrame {
  container: HTMLDivElement;
  root: Root;
}

class ManualAnimationFrameHost {
  private readonly callbacks = new Map<number, FrameRequestCallback>();
  private nextFrameId = 1;

  readonly cancelAnimationFrame = (frameId: number): void => {
    this.callbacks.delete(frameId);
  };

  readonly requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const frameId = this.nextFrameId;
    this.nextFrameId += 1;
    this.callbacks.set(frameId, callback);
    return frameId;
  };

  flush(timestamp: number): void {
    const next = this.callbacks.entries().next().value as
      [number, FrameRequestCallback] | undefined;
    if (!next) {
      throw new Error("No pending animation frame to flush.");
    }
    this.callbacks.delete(next[0]);
    next[1](timestamp);
  }

  pendingFrameCount(): number {
    return this.callbacks.size;
  }
}

function requiredFrameRate(parent: ParentNode): HTMLOutputElement {
  const frameRate = parent.querySelector<HTMLOutputElement>(
    "output.playground-frame-rate",
  );
  if (!frameRate) {
    throw new Error("Missing playground display frame-rate telemetry.");
  }
  return frameRate;
}
