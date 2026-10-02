import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceMinimapPresentation,
  workspaceMinimapView,
} from "../src/presentation/workspace-minimap-presentation";
import type { PaneRenderItem, WorkspaceWorldFrame } from "../src/types";
import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import type {
  OnirigiriWorkspaceHandle,
  OnirigiriWorkspaceProps,
} from "../src/workspace/onirigiri-workspace-types";

import {
  requiredElement,
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

const viewport = { height: 900, width: 1200, x: 0, y: 0 };

describe("workspace minimap presentation", () => {
  it("spans every pane and the visible world area in world coordinates", () => {
    const view = workspaceMinimapView(
      [
        paneItem("near", { x: 0, y: 0 }),
        paneItem("far", { focused: true, scale: 2, x: 3000, y: 200 }),
      ],
      worldFrame({ scale: 0.5, x: 100, y: 50 }),
      viewport,
    );

    expect(view.visible).toEqual({
      height: 1800,
      width: 2400,
      x: -200,
      y: -100,
    });
    expect(view.panes[1]).toEqual({
      focused: true,
      height: 800,
      paneId: "far",
      width: 1000,
      x: 3000,
      y: 200,
    });
    const content = { height: 1800, width: 4200, x: -200, y: -100 };
    expect(view.bounds.x).toBeLessThan(content.x);
    expect(view.bounds.y).toBeLessThan(content.y);
    expect(view.bounds.x + view.bounds.width).toBeGreaterThan(
      content.x + content.width,
    );
    expect(view.bounds.y + view.bounds.height).toBeGreaterThan(
      content.y + content.height,
    );
  });

  it("draws the last presented frame on bind and follows pane changes", () => {
    const presentation = new WorkspaceMinimapPresentation();
    presentation.apply(
      [
        paneItem("a", { focused: true, x: 0, y: 0 }),
        paneItem("b", { x: 600, y: 0 }),
      ],
      worldFrame({ scale: 1, x: 0, y: 0 }),
      viewport,
    );
    const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const unbind = presentation.bindMinimapHost(host);

    expect(minimapPaneStates(host)).toEqual([
      ["a", "true"],
      ["b", "false"],
    ]);
    expect(host.getAttribute("viewBox")).not.toBeNull();
    expect(
      Number(
        host
          .querySelector("[data-onirigiri-minimap-viewport]")
          ?.getAttribute("width"),
      ),
    ).toBe(1200);

    presentation.apply(
      [paneItem("b", { focused: true, x: 600, y: 0 })],
      worldFrame({ scale: 1, x: -600, y: 0 }),
      viewport,
    );
    expect(minimapPaneStates(host)).toEqual([["b", "true"]]);
    expect(
      Number(
        host
          .querySelector("[data-onirigiri-minimap-viewport]")
          ?.getAttribute("x"),
      ),
    ).toBe(600);

    unbind();
    expect(host.childElementCount).toBe(0);
  });
});

describe("workspace minimap component", () => {
  let animationFrames: FrameRequestCallback[];
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
    animationFrames = [];
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
          cameraModes={{ normal: "fixed", overview: "fixed" }}
          focusAnchor="start"
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
    await flushFrames();
    return requiredWorkspaceHandle(workspaceRef.current);
  }

  async function flushFrames(): Promise<void> {
    for (let frame = 0; frame < 20 && animationFrames.length > 0; frame += 1) {
      const callbacks = animationFrames.splice(0);
      await act(async () => {
        for (const callback of callbacks) {
          callback(performance.now() + frame * 16);
        }
      });
    }
  }

  it("is absent unless the host opts in", async () => {
    await renderWorkspace();

    expect(
      container.querySelector('[data-onirigiri-slot="minimap"]'),
    ).toBeNull();
  });

  it("renders in compact layout when the host enables it", async () => {
    await renderWorkspace({ compactBreakpoint: 100_000, showMinimap: true });
    expect(
      container
        .querySelector('[data-onirigiri-slot="workspace"]')
        ?.getAttribute("data-compact-layout"),
    ).toBe("true");
    expect(
      container.querySelector('[data-onirigiri-slot="minimap"]'),
    ).not.toBeNull();
  });

  it("draws every pane as a box and focuses the pane under a click", async () => {
    const workspace = await renderWorkspace({ showMinimap: true });
    const minimap = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="minimap"]',
    );

    expect(minimap.dataset.corner).toBe("bottom-right");
    expect(minimap.getAttribute("aria-hidden")).toBe("true");
    expect(minimapPaneStates(minimap)).toEqual([
      ["pane-1", "true"],
      ["pane-2", "false"],
      ["pane-3", "false"],
    ]);

    const target = requiredElement<SVGRectElement>(
      minimap,
      '[data-onirigiri-minimap-pane-id="pane-3"]',
    );
    await act(async () => {
      pointer(target, "pointerdown", 1000, 800);
      pointer(minimap, "pointerup", 1001, 800);
    });
    await flushFrames();

    expect(workspace.getSnapshot().focusedPaneId).toBe("pane-3");
    expect(minimap.style.width).toBe("200px");
    expect(minimap.style.height).toBe("140px");
    expect(minimapPaneStates(minimap)).toEqual([
      ["pane-1", "false"],
      ["pane-2", "false"],
      ["pane-3", "true"],
    ]);
  });

  it("moves to the nearest corner and resizes from its inner corner", async () => {
    const onMinimapPlacementChange = vi.fn();
    const workspace = await renderWorkspace({
      onMinimapPlacementChange,
      showMinimap: true,
    });
    const minimap = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="minimap"]',
    );
    minimap.getBoundingClientRect = () => new DOMRect(40, 30, 200, 140);

    await act(async () => {
      pointer(minimap, "pointerdown", 1100, 850);
      pointer(minimap, "pointermove", 140, 100);
    });
    expect(minimap.dataset.adjusting).toBe("true");
    await act(async () => pointer(minimap, "pointerup", 140, 100));

    expect(minimap.dataset.corner).toBe("top-left");
    expect(minimap.dataset.adjusting).toBeUndefined();
    expect(minimap.style.translate).toBe("");
    expect(onMinimapPlacementChange).toHaveBeenLastCalledWith({
      corner: "top-left",
      heightPx: 140,
      widthPx: 200,
    });
    expect(workspace.getSnapshot().focusedPaneId).toBe("pane-1");

    const handle = requiredElement<HTMLElement>(
      minimap,
      '[data-onirigiri-slot="minimap-resize"]',
    );
    await act(async () => {
      pointer(handle, "pointerdown", 240, 170);
      pointer(handle, "pointermove", 300, 200);
      pointer(handle, "pointerup", 300, 200);
    });

    expect(onMinimapPlacementChange).toHaveBeenLastCalledWith({
      corner: "top-left",
      heightPx: 170,
      widthPx: 260,
    });
    expect(minimap.style.width).toBe("260px");
    expect(minimap.style.height).toBe("170px");
  });

  it("follows host placement and can be locked in place", async () => {
    const onMinimapPlacementChange = vi.fn();
    await renderWorkspace({
      minimapAdjustable: false,
      minimapPlacement: { corner: "top-right", widthPx: 240 },
      onMinimapPlacementChange,
      showMinimap: true,
    });
    const minimap = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="minimap"]',
    );

    expect(minimap.dataset.corner).toBe("top-right");
    expect(minimap.style.width).toBe("240px");
    expect(
      minimap.querySelector('[data-onirigiri-slot="minimap-resize"]'),
    ).toBeNull();

    await act(async () => {
      pointer(minimap, "pointerdown", 1100, 100);
      pointer(minimap, "pointermove", 100, 800);
      pointer(minimap, "pointerup", 100, 800);
    });
    expect(minimap.dataset.corner).toBe("top-right");
    expect(onMinimapPlacementChange).not.toHaveBeenCalled();

    await renderWorkspace({
      minimapAdjustable: false,
      minimapPlacement: { corner: "bottom-left", widthPx: 240 },
      showMinimap: true,
    });
    expect(minimap.dataset.corner).toBe("bottom-left");
  });
});

function pointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, clientX, clientY }),
  );
}

function minimapPaneStates(
  host: Element,
): Array<[string | null, string | null]> {
  return [...host.querySelectorAll("[data-onirigiri-minimap-pane-id]")].map(
    (pane) => [
      pane.getAttribute("data-onirigiri-minimap-pane-id"),
      pane.getAttribute("data-focused"),
    ],
  );
}

function paneItem(
  paneId: string,
  overrides: Partial<PaneRenderItem> & { x: number; y: number },
): PaneRenderItem {
  return {
    focused: false,
    height: 400,
    maximized: false,
    moving: false,
    opacity: 1,
    paneId,
    presentationMode: "normal",
    resizing: false,
    runtimeState: "live",
    scale: 1,
    surfaceId: paneId,
    surfaceKind: "test",
    visible: true,
    width: 500,
    z: 0,
    ...overrides,
  };
}

function worldFrame(
  transform: Pick<WorkspaceWorldFrame, "scale" | "x" | "y">,
): WorkspaceWorldFrame {
  return {
    focalScreenX: 0,
    focalScreenY: 0,
    focalWorldX: 0,
    focalWorldY: 0,
    grid: { height: 0, width: 0, x: 0, y: 0 },
    ...transform,
  };
}
