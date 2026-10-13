import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import type {
  OnirigiriWorkspaceHandle,
  OnirigiriWorkspaceProps,
} from "../src/workspace/onirigiri-workspace-types";

import {
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

describe("workspace motion options", () => {
  let animationFrames: FrameRequestCallback[];
  let container: HTMLDivElement;
  let root: Root;
  let now: number;

  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
    animationFrames = [];
    now = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderWorkspace(
    props: Partial<OnirigiriWorkspaceProps> = {},
  ): Promise<OnirigiriWorkspaceHandle> {
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={["pane-1", "pane-2", "pane-3"].map((paneId) => ({
            columnWidth: { unit: "px" as const, value: 520 },
            paneId,
            surfaceKind: "test",
            title: paneId,
          }))}
          ref={workspaceRef}
          renderPane={(pane) => <div>{pane.title}</div>}
          {...props}
        />,
      );
    });
    await advanceFrames(20, 16);
    return requiredWorkspaceHandle(workspaceRef.current);
  }

  async function advanceFrames(count: number, stepMs: number): Promise<void> {
    for (
      let frame = 0;
      frame < count && animationFrames.length > 0;
      frame += 1
    ) {
      const callbacks = animationFrames.splice(0);
      now += stepMs;
      await act(async () => {
        for (const callback of callbacks) {
          callback(now);
        }
      });
    }
  }

  it("renders the focus highlight unless the host disables it", async () => {
    await renderWorkspace();
    expect(
      container.querySelector('[data-onirigiri-slot="grid-cursor"]'),
    ).not.toBeNull();

    await renderWorkspace({ focusHighlight: false });
    expect(
      container.querySelector('[data-onirigiri-slot="grid-cursor"]'),
    ).toBeNull();

    await renderWorkspace({ focusHighlight: { motion: { durationMs: 115 } } });
    expect(
      container.querySelector('[data-onirigiri-slot="grid-cursor"]'),
    ).not.toBeNull();
  });

  it("moves the camera along a host-supplied curve", async () => {
    const workspace = await renderWorkspace({
      cameraMotion: {
        navigation: { durationMs: 320, easing: (progress) => progress },
      },
    });
    const start = workspace.getSnapshot().scrollColumn;

    await act(async () => {
      workspace.focus("right");
    });
    const target = workspace.getSnapshot().targetScrollColumn;
    expect(target).not.toBe(start);

    await advanceFrames(1, 16);
    await advanceFrames(1, 160);
    const halfway = workspace.getSnapshot().scrollColumn;
    expect(Math.abs(halfway - start)).toBeGreaterThan(
      Math.abs(target - start) * 0.4,
    );
    expect(Math.abs(halfway - start)).toBeLessThan(
      Math.abs(target - start) * 0.65,
    );

    await advanceFrames(20, 16);
    expect(workspace.getSnapshot().scrollColumn).toBe(target);
  });

  it("updates overview distance without replacing native content or the layout", async () => {
    const props = {
      liveContent: true,
      renderPane: () => <input aria-label="Draft" defaultValue="Original" />,
    };
    const workspace = await renderWorkspace({
      ...props,
      overviewCardMinWidthPx: 80,
      overviewCardMaxWidthPx: 80,
    });
    const input = container.querySelector("input")!;
    input.value = "Keep this draft";
    const layout = workspace.getLayout();
    await act(async () => workspace.toggleOverview());
    await advanceFrames(60, 16);
    const farScale = workspace.getSnapshot().overviewFixedScale!;

    await renderWorkspace({
      ...props,
      overviewCardMinWidthPx: 240,
      overviewCardMaxWidthPx: 240,
    });
    await advanceFrames(60, 16);
    expect(workspace.getSnapshot().overviewFixedScale).toBeGreaterThan(
      farScale,
    );
    expect(workspace.getSnapshot().presentationMode).toBe("overview");
    expect(workspace.getLayout()).toEqual(layout);
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("Keep this draft");

    await act(async () => workspace.toggleOverview());
    await advanceFrames(60, 16);
    expect(input.closest("[inert]")).toBeNull();
    input.focus();
    expect(document.activeElement).toBe(input);
  });
});
