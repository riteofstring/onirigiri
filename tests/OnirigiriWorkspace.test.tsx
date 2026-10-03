import { act, createRef, useState, type ButtonHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import { paneCellSizingForPane } from "../src/layout/pane-cell-sizing";
import type { OnirigiriWorkspaceHandle } from "../src/workspace/onirigiri-workspace-types";

import {
  paneLocation,
  requiredElement,
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
  workspacePaneIds,
  workspaceRowSizingSnapshot,
} from "./onirigiri-workspace-test-support";

describe("OnirigiriWorkspace interactions", () => {
  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses pane content without moving the camera and reveals only from the title bar", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const contentAction = vi.fn();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          cameraModes={{ normal: "fixed", overview: "fixed" }}
          focusAnchor="start"
          initialPanes={fixedWidthPanes(3)}
          ref={workspaceRef}
          renderPane={(pane) => (
            <button
              onClick={contentAction}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              Use {pane.title}
            </button>
          )}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const adjacentPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-2"]',
    );
    const adjacentContentButton = requiredElement<HTMLButtonElement>(
      adjacentPane,
      ".onirigiri-pane__content button",
    );

    await act(async () => dispatchPointerDown(adjacentContentButton));
    await act(async () =>
      requiredElement<HTMLButtonElement>(
        adjacentPane,
        ".onirigiri-pane__content button",
      ).click(),
    );
    expect(contentAction).toHaveBeenCalledTimes(1);
    expect(workspace.getSnapshot()).toMatchObject({
      focusedPaneId: "pane-2",
      scrollColumn: 0,
      targetScrollColumn: 0,
    });
    expect(adjacentPane.dataset.moving).toBe("false");

    const adjacentTitlebar = requiredElement<HTMLElement>(
      adjacentPane,
      ".onirigiri-pane__titlebar",
    );
    await act(async () => dispatchPointerDown(adjacentTitlebar));
    expect(workspace.getSnapshot().focusedPaneId).toBe("pane-2");
    expect(workspace.getSnapshot().targetScrollColumn).toBeGreaterThan(0);

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders every pane intersecting a wide viewport as live content", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          cameraModes={{ normal: "fixed", overview: "fixed" }}
          focusAnchor="start"
          initialPanes={fixedWidthPanes(4, 180)}
          renderPane={(pane, state) => (
            <output
              data-pane-content={pane.paneId}
              data-runtime-state={state.runtimeState}
            >
              {pane.title}
            </output>
          )}
        />,
      );
    });

    const panes = [
      ...container.querySelectorAll<HTMLElement>("[data-onirigiri-pane-id]"),
    ];
    expect(panes).toHaveLength(4);
    expect(panes.every((pane) => pane.dataset.visible === "true")).toBe(true);
    expect(panes.every((pane) => pane.dataset.runtimeState === "live")).toBe(
      true,
    );
    expect(container.querySelectorAll("[data-pane-content]")).toHaveLength(4);

    await act(async () => root.unmount());
    container.remove();
  });

  it("resizes every pane to minimum and full stage dimensions with one update each", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const onLayoutChange = vi.fn();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            {
              columnId: "split-column",
              columnWidth: { unit: "px", value: 420 },
              paneId: "split-top",
              surfaceKind: "test",
              title: "Split top",
            },
            {
              columnId: "split-column",
              paneId: "split-bottom",
              surfaceKind: "test",
              title: "Split bottom",
            },
            {
              columnId: "right-column",
              columnWidth: { unit: "px", value: 360 },
              paneId: "right",
              surfaceKind: "test",
              title: "Right",
            },
          ]}
          onLayoutChange={onLayoutChange}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    onLayoutChange.mockClear();

    const revisionBeforeMinimum = workspace.getSnapshot().layoutRevision;
    await act(async () => workspace.resizePanes("minimum"));
    expect(
      workspace.getScene().columns.map((column) => column.widthSpec),
    ).toEqual([
      { unit: "px", value: 96 },
      { unit: "px", value: 96 },
    ]);
    expect(paneHeights(workspace.getScene())).toEqual([96, 96, 96]);
    expect(workspace.getSnapshot().layoutRevision).toBe(
      revisionBeforeMinimum + 1,
    );
    expect(onLayoutChange).toHaveBeenCalledTimes(1);

    const revisionBeforeFull = workspace.getSnapshot().layoutRevision;
    await act(async () => workspace.resizePanes("full"));
    expect(
      workspace.getScene().columns.map((column) => column.widthSpec),
    ).toEqual([
      { unit: "px", value: 1180 },
      { unit: "px", value: 1180 },
    ]);
    expect(paneHeights(workspace.getScene())).toEqual([880, 880, 880]);
    expect(workspace.getSnapshot().layoutRevision).toBe(revisionBeforeFull + 1);
    expect(onLayoutChange).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    container.remove();
  });

  it("supports keyboard resizing and reset from the exact-edge handles", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "source", surfaceKind: "test", title: "Source" },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });

    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const pane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="source"]',
    );
    const columnHandle = requiredElement<HTMLButtonElement>(
      pane,
      '[data-onirigiri-slot="pane-resize-column"]',
    );
    const rowHandle = requiredElement<HTMLButtonElement>(
      pane,
      '[data-onirigiri-slot="pane-resize-row"]',
    );
    const initialWidth = Number.parseFloat(pane.style.width);
    const initialHeight = Number.parseFloat(pane.style.height);

    expect(columnHandle.getAttribute("aria-keyshortcuts")).toContain(
      "ArrowRight",
    );
    expect(rowHandle.getAttribute("aria-keyshortcuts")).toContain("ArrowDown");

    const widthEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    await act(async () => columnHandle.dispatchEvent(widthEvent));
    expect(widthEvent.defaultPrevented).toBe(true);
    expect(workspace.getScene().columns[0]?.widthSpec).toEqual({
      unit: "px",
      value: Math.max(180, initialWidth + 16),
    });

    const heightEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowUp",
    });
    await act(async () => rowHandle.dispatchEvent(heightEvent));
    expect(heightEvent.defaultPrevented).toBe(true);
    expect(paneHeight(workspace.getScene(), "source")).toBe(
      Math.max(96, initialHeight - 16),
    );

    const resetEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    await act(async () => rowHandle.dispatchEvent(resetEvent));
    expect(resetEvent.defaultPrevented).toBe(true);
    expect(paneHeight(workspace.getScene(), "source")).toBeUndefined();

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps row sizing on structural cells when a pane rearranges", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={twoDimensionalPanes()}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const source = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="source"]',
    );
    const rowHandle = requiredElement<HTMLButtonElement>(
      source,
      '[data-onirigiri-slot="pane-resize-row"]',
    );
    await pressKey(rowHandle, "ArrowUp");
    const sizingBefore = workspaceRowSizingSnapshot(workspace.getScene());

    await act(async () => workspace.movePane("right"));

    expect(workspaceRowSizingSnapshot(workspace.getScene())).toEqual(
      sizingBefore,
    );
    expect(
      workspacePaneIds(
        workspace
          .getScene()
          .columns.find((column) => column.columnId === "source-column"),
      ),
    ).toEqual(["right"]);
    expect(
      workspacePaneIds(
        workspace
          .getScene()
          .columns.find((column) => column.columnId === "right-column"),
      ),
    ).toEqual(["source"]);

    await act(async () => root.unmount());
    container.remove();
  });

  it("retains focused resize handles through reanchor motion for repeated keyboard resizing", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={fixedWidthPanes(2, 520)}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });

    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const pane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-2"]',
    );
    const columnHandle = requiredElement<HTMLButtonElement>(
      pane,
      '[data-onirigiri-slot="pane-resize-column"]',
    );
    const rowHandle = requiredElement<HTMLButtonElement>(
      pane,
      '[data-onirigiri-slot="pane-resize-row"]',
    );
    const initialWidth = Number.parseFloat(pane.style.width);
    const initialHeight = Number.parseFloat(pane.style.height);

    columnHandle.focus();
    await pressKey(columnHandle, "ArrowRight");

    expect(workspace.getSnapshot().scrollColumn).not.toBe(
      workspace.getSnapshot().targetScrollColumn,
    );
    expect(columnHandle.isConnected).toBe(true);
    expect(rowHandle.isConnected).toBe(true);
    expect(document.activeElement).toBe(columnHandle);

    await pressKey(columnHandle, "ArrowRight");
    expect(workspace.getScene().columns[1]?.widthSpec).toEqual({
      unit: "px",
      value: initialWidth + 32,
    });

    rowHandle.focus();
    await pressKey(rowHandle, "ArrowUp");
    expect(rowHandle.isConnected).toBe(true);
    expect(document.activeElement).toBe(rowHandle);

    await pressKey(rowHandle, "ArrowUp");
    expect(paneHeight(workspace.getScene(), "pane-2")).toBe(initialHeight - 32);

    await act(async () => root.unmount());
    container.remove();
  });

  it("freezes the original DOM content and does not rerender it on animation frames", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const renderPane = vi.fn(() => <div>Animated content</div>);

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "source", surfaceKind: "test", title: "Source" },
          ]}
          ref={workspaceRef}
          renderPane={renderPane}
        />,
      );
    });
    const initialFrame = animationFrames.shift();
    expect(initialFrame).toBeDefined();
    await act(async () => initialFrame?.(0));
    animationFrames.length = 0;

    await act(async () => workspaceRef.current?.toggleOverview());
    const callsAtFreeze = renderPane.mock.calls.length;
    const pane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="source"]',
    );
    const originalContent = requiredElement<HTMLElement>(
      pane,
      ".onirigiri-pane__live-content > div",
    );
    expect(pane.dataset.runtimeState).toBe("frozen");
    expect(
      pane.querySelector('[data-onirigiri-frozen-texture="true"]'),
    ).toBeNull();

    for (let index = 1; index <= 5; index += 1) {
      const frame = animationFrames.shift();
      expect(frame).toBeDefined();
      await act(async () => frame?.(index * (1000 / 120)));
    }
    expect(renderPane).toHaveBeenCalledTimes(callsAtFreeze);
    expect(
      requiredElement<HTMLElement>(pane, ".onirigiri-pane__live-content > div"),
    ).toBe(originalContent);

    await act(async () => root.unmount());
    container.remove();
  });

  it("preserves application state through rapid focus retargets", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const renderPane = vi.fn((pane: { paneId: string }) => (
      <input aria-label={`Notes for ${pane.paneId}`} defaultValue="Original" />
    ));

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={fixedWidthPanes(5, 320)}
          ref={workspaceRef}
          renderPane={renderPane}
          showControls={false}
        />,
      );
    });
    const initialFrame = animationFrames.shift();
    expect(initialFrame).toBeDefined();
    await act(async () => initialFrame?.(0));
    animationFrames.length = 0;

    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    await act(async () => workspace.focusPane("pane-4"));
    expect(workspace.getSnapshot().scrollColumn).not.toBe(
      workspace.getSnapshot().targetScrollColumn,
    );
    const input = requiredElement<HTMLInputElement>(
      container,
      '[aria-label="Notes for pane-4"]',
    );
    input.value = "Keep my edits";

    await act(async () => workspace.focusPane("pane-5"));

    expect(workspace.getSnapshot().focusedPaneId).toBe("pane-5");
    expect(requiredElement(container, '[aria-label="Notes for pane-4"]')).toBe(
      input,
    );
    expect(input.value).toBe("Keep my edits");
    const rendersAfterRetarget = renderPane.mock.calls.length;
    for (let index = 1; index <= 5; index++) {
      const frame = animationFrames.shift();
      expect(frame).toBeDefined();
      await act(async () => frame?.(index * (1000 / 120)));
    }
    expect(renderPane).toHaveBeenCalledTimes(rendersAfterRetarget);
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe("Keep my edits");

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps overview-exit resize chrome scoped to the focused pane until idle", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 0, 3840, 2160),
    );
    const animationFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.set(++nextFrameId, callback);
        return nextFrameId;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      animationFrames.delete(id);
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const renderPane = vi.fn((pane: { title: string }) => (
      <div>{pane.title}</div>
    ));

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          compactBreakpoint={0}
          initialPanes={fixedWidthPanes(100, 300)}
          ref={workspaceRef}
          renderPane={renderPane}
          showControls={false}
        />,
      );
    });

    const runFrame = (timestamp: number) => {
      const frames = [...animationFrames];
      expect(frames.length).toBeGreaterThan(0);
      act(() => {
        for (const [id, frame] of frames) {
          if (!animationFrames.delete(id)) continue;
          frame(timestamp);
        }
      });
    };
    const advanceFrames = (start: number, end: number) => {
      for (let index = start; index <= end; index += 1) {
        if (animationFrames.size === 0) {
          return;
        }
        runFrame(index * (1000 / 60));
      }
    };
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    runFrame(0);

    await act(async () => workspace.toggleOverview());
    advanceFrames(1, 64);
    expect(workspace.getSnapshot().presentationMode).toBe("overview");
    expect(container.querySelectorAll(".onirigiri-pane__resize")).toHaveLength(
      0,
    );

    await act(async () => workspace.toggleOverview());
    expect(workspace.getSnapshot().presentationMode).toBe("normal");
    const mountedPaneCount = container.querySelectorAll(
      "[data-onirigiri-pane-id]",
    ).length;
    expect(mountedPaneCount).toBeGreaterThan(20);
    const focusedPane = requiredElement<HTMLElement>(
      container,
      `[data-onirigiri-pane-id="${workspace.getSnapshot().focusedPaneId}"]`,
    );
    const unfocusedPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-2"]',
    );
    expect(
      focusedPane.querySelectorAll(".onirigiri-pane__resize"),
    ).toHaveLength(2);
    expect(container.querySelectorAll(".onirigiri-pane__resize")).toHaveLength(
      2,
    );
    expect(
      unfocusedPane.querySelectorAll(".onirigiri-pane__resize"),
    ).toHaveLength(0);
    const rendersAfterExitRequest = renderPane.mock.calls.length;

    runFrame(65 * (1000 / 60));
    expect(unfocusedPane.dataset.presentationMode).toBe("normal");
    expect(unfocusedPane.dataset.moving).toBe("true");
    expect(renderPane).toHaveBeenCalledTimes(rendersAfterExitRequest);

    advanceFrames(66, 128);
    expect(workspace.getSnapshot().overviewProgress).toBe(0);
    expect(
      unfocusedPane.querySelectorAll(".onirigiri-pane__resize"),
    ).toHaveLength(2);
    expect(renderPane.mock.calls.length).toBeGreaterThan(
      rendersAfterExitRequest,
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not let an unrelated React render overwrite presented motion", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const initialPanes = ["a", "b", "c"].map((paneId, index) => ({
      columnId: `column-${paneId}`,
      columnWidth: { unit: "px" as const, value: 300 },
      paneId,
      slotIndex: index,
      surfaceKind: "test",
      title: paneId.toUpperCase(),
    }));
    const workspace = (ariaLabel: string) => (
      <OnirigiriWorkspace
        ariaLabel={ariaLabel}
        initialPanes={initialPanes}
        ref={workspaceRef}
        renderPane={(pane) => <div>{pane.title}</div>}
      />
    );

    await act(async () => root.render(workspace("Workspace")));
    const initialFrame = animationFrames.shift();
    expect(initialFrame).toBeDefined();
    await act(async () => initialFrame?.(0));
    animationFrames.length = 0;

    await act(async () => workspaceRef.current?.focusPane("c"));
    const source = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="a"]',
    );
    for (let index = 1; index <= 3; index += 1) {
      const frame = animationFrames.shift();
      expect(frame).toBeDefined();
      await act(async () => frame?.(index * (1000 / 120)));
    }
    const presentedTransform = source.style.transform;
    expect(presentedTransform).not.toContain("translate3d(0.00px");

    await act(async () => root.render(workspace("Renamed workspace")));
    expect(source.style.transform).toBe(presentedTransform);

    await act(async () => root.unmount());
    container.remove();
  });

  it("parks activated offscreen panes without losing application state", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const initialPanes = fixedWidthPanes(7);
    const renderPane = (pane: { paneId: string }) => (
      <StatefulTestPane paneId={pane.paneId} />
    );
    const renderWorkspace = (showControls: boolean) => (
      <OnirigiriWorkspace
        compactBreakpoint={0}
        initialPanes={initialPanes}
        ref={workspaceRef}
        renderPane={renderPane}
        showControls={showControls}
      />
    );

    await act(async () => {
      root.render(renderWorkspace(true));
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);

    await act(async () => {
      workspace.focusPane("pane-5");
    });
    const paneFive = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-5"]',
    );
    const counter = () =>
      requiredElement<HTMLButtonElement>(paneFive, '[data-counter="pane-5"]');
    const columnResizeHandle = () =>
      paneFive.querySelectorAll('[data-onirigiri-slot="pane-resize-column"]');
    const rowResizeHandle = () =>
      paneFive.querySelectorAll('[data-onirigiri-slot="pane-resize-row"]');
    const paneActions = () =>
      paneFive.querySelectorAll('[data-onirigiri-slot="pane-action"]');
    expect(paneFive.dataset.visible).toBe("true");
    expect(columnResizeHandle()).toHaveLength(1);
    expect(rowResizeHandle()).toHaveLength(1);
    expect(paneActions()).toHaveLength(2);
    await act(async () => counter().click());
    expect(counter().textContent).toBe("1");
    const retainedCounter = counter();

    await act(async () => {
      workspace.focusPane("pane-1");
    });
    expect(paneFive.dataset.visible).toBe("false");
    expect(paneFive.dataset.runtimeState).toBe("hidden");
    expect(columnResizeHandle()).toHaveLength(0);
    expect(rowResizeHandle()).toHaveLength(0);
    expect(paneActions()).toHaveLength(2);
    expect(counter()).toBe(retainedCounter);
    expect(counter().textContent).toBe("1");

    await act(async () => root.render(renderWorkspace(false)));
    expect(paneFive.dataset.visible).toBe("false");
    expect(paneActions()).toHaveLength(0);
    expect(counter()).toBe(retainedCounter);

    await act(async () => {
      workspace.focusPane("pane-5");
    });
    expect(paneFive.dataset.visible).toBe("true");
    expect(columnResizeHandle()).toHaveLength(1);
    expect(rowResizeHandle()).toHaveLength(1);
    expect(counter()).toBe(retainedCounter);
    expect(counter().textContent).toBe("1");

    await act(async () => root.unmount());
    container.remove();
  });

  it("reconciles idle retention when the area budget changes", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const initialPanes = fixedWidthPanes(7);
    const renderPane = (pane: { paneId: string }) => <div>{pane.paneId}</div>;
    const renderWorkspace = (retainedAreaBudgetViewports: number) => (
      <OnirigiriWorkspace
        compactBreakpoint={0}
        initialPanes={initialPanes}
        ref={workspaceRef}
        renderPane={renderPane}
        retainedAreaBudgetViewports={retainedAreaBudgetViewports}
        showControls={false}
      />
    );

    await act(async () => root.render(renderWorkspace(8)));
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    await act(async () => workspace.focusPane("pane-5"));
    await act(async () => workspace.focusPane("pane-1"));
    expect(
      requiredElement<HTMLElement>(
        container,
        '[data-onirigiri-pane-id="pane-5"]',
      ).dataset.visible,
    ).toBe("false");

    await act(async () => root.render(renderWorkspace(1)));

    const shell = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-5"]',
    );
    expect(shell.hidden).toBe(false);
    expect(
      shell.querySelector(".onirigiri-pane__live-content")?.textContent,
    ).toBe("");

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps compact panes live while only the focused pane is interactive", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          compactBreakpoint={Number.POSITIVE_INFINITY}
          compactPanePeek={18}
          initialPanes={fixedWidthPanes(2, 320)}
          renderPane={(pane) => <button type="button">Use {pane.title}</button>}
        />,
      );
    });

    const workspace = requiredElement<HTMLElement>(
      container,
      ".onirigiri-workspace",
    );
    const firstPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-1"]',
    );
    const secondPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-2"]',
    );
    const toolbar = requiredElement<HTMLElement>(
      container,
      ".onirigiri-workspace__toolbar",
    );

    expect(workspace.dataset.compactLayout).toBe("true");
    expect(workspace.dataset.compactPanePeek).toBe("true");
    expect(toolbar.dataset.layout).toBe("compact");
    expect(firstPane.dataset.runtimeState).toBe("live");
    expect(firstPane.hasAttribute("inert")).toBe(false);
    expect(secondPane.dataset.runtimeState).toBe("live");
    expect(secondPane.hasAttribute("inert")).toBe(true);
    expect(container.querySelectorAll(".onirigiri-pane__resize")).toHaveLength(
      0,
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("exposes every 2D ref placement with one committed layout update", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const onLayoutChange = vi.fn();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            {
              columnId: "source-column",
              paneId: "source",
              planeIndex: 0,
              slotIndex: 0,
              surfaceKind: "test",
              title: "Source",
            },
          ]}
          onLayoutChange={onLayoutChange}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    onLayoutChange.mockClear();

    let splitAboveId = "";
    await act(async () => {
      splitAboveId = workspace.splitPaneToPlane("source", "up");
    });
    expect(onLayoutChange).toHaveBeenCalledTimes(1);

    let splitBelowId = "";
    await act(async () => {
      splitBelowId = workspace.splitPaneToPlane("source", "down");
    });
    expect(onLayoutChange).toHaveBeenCalledTimes(2);

    let rightId = "";
    await act(async () => {
      rightId = workspace.openPaneNear("source", "right", {
        surfaceKind: "test",
        title: "Right neighbor",
      });
    });
    expect(onLayoutChange).toHaveBeenCalledTimes(3);

    let aboveId = "";
    await act(async () => {
      aboveId = workspace.openPaneNear("source", "above", {
        surfaceKind: "test",
        title: "Above neighbor",
      });
    });
    expect(onLayoutChange).toHaveBeenCalledTimes(4);

    let belowId = "";
    await act(async () => {
      belowId = workspace.openPaneNear("source", "below", {
        surfaceKind: "test",
        title: "Below neighbor",
      });
    });
    expect(onLayoutChange).toHaveBeenCalledTimes(5);

    expect(paneLocation(workspace, splitAboveId)).toEqual({
      planeIndex: -2,
      slotIndex: 0,
    });
    expect(paneLocation(workspace, aboveId)).toEqual({
      planeIndex: -1,
      slotIndex: 0,
    });
    expect(paneLocation(workspace, "source")).toEqual({
      planeIndex: 0,
      slotIndex: 0,
    });
    expect(paneLocation(workspace, rightId)).toEqual({
      planeIndex: 0,
      slotIndex: 1,
    });
    expect(paneLocation(workspace, belowId)).toEqual({
      planeIndex: 1,
      slotIndex: 0,
    });
    expect(paneLocation(workspace, splitBelowId)).toEqual({
      planeIndex: 2,
      slotIndex: 0,
    });
    expect(workspace.getScene().paneById.get(aboveId)).toMatchObject({
      surfaceKind: "test",
      title: "Above neighbor",
    });
    expect(workspace.getSnapshot().focusedPaneId).toBe(belowId);

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps every normal-mode pane action available when its pane is not focused", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={twoDimensionalPanes()}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });

    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const rightPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="right"][data-focused="false"]',
    );
    const rightActions = requiredElement<HTMLElement>(
      rightPane,
      ".onirigiri-pane__actions",
    );
    const actionButtons =
      rightActions.querySelectorAll<HTMLButtonElement>("button");

    expect(rightActions.getAttribute("aria-hidden")).toBe("false");
    expect(rightActions.dataset.visible).toBe("true");
    expect(
      Array.from(actionButtons, (button) => button.getAttribute("aria-label")),
    ).toEqual(["Maximize pane", "Close pane"]);
    for (const button of actionButtons) {
      expect(button.tabIndex).toBe(0);
      expect(button.disabled).toBe(false);
    }

    const maximizeButton = requiredElement<HTMLButtonElement>(
      rightActions,
      'button[aria-label="Maximize pane"]',
    );
    await act(async () => maximizeButton.click());
    expect(workspace.getSnapshot().maximizedPaneId).toBe("right");
    await act(async () =>
      requiredElement<HTMLButtonElement>(
        rightActions,
        'button[aria-label="Restore pane"]',
      ).click(),
    );
    expect(workspace.getSnapshot().maximizedPaneId).toBeNull();
    await act(async () =>
      requiredElement<HTMLButtonElement>(
        rightActions,
        'button[aria-label="Close pane"]',
      ).click(),
    );
    expect(workspace.getScene().paneById.has("right")).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders plain accessible controls without tooltip markup", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          gridAxes="horizontal"
          initialPanes={twoDimensionalPanes()}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const toolbar = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Workspace controls"]',
    );
    const controls = [
      ...toolbar.querySelectorAll<HTMLElement>("[data-onirigiri-control]"),
    ];
    const control = (id: string) =>
      requiredElement<HTMLButtonElement>(
        toolbar,
        `button[data-onirigiri-control="${id}"]`,
      );

    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    expect(container.querySelector("kbd")).toBeNull();
    expect(controls.map((element) => element.dataset.onirigiriControl)).toEqual(
      ["overview", "move-up", "move-down", "move-left", "move-right"],
    );
    for (const element of controls) {
      expect(element).toBeInstanceOf(HTMLButtonElement);
      expect(element.getAttribute("type")).toBe("button");
      expect(element.hasAttribute("aria-describedby")).toBe(false);
      expect(element.hasAttribute("title")).toBe(false);
      expect(element.querySelector("svg")).not.toBeNull();
    }
    expect(control("move-right").getAttribute("aria-label")).toBe(
      "Move cursor right",
    );
    expect(control("move-right").getAttribute("aria-keyshortcuts")).toBe(
      "Alt+ArrowRight Alt+L",
    );
    expect(control("move-right").dataset.available).toBe("true");
    expect(control("move-right").hasAttribute("aria-disabled")).toBe(false);
    expect(control("move-right").hasAttribute("aria-pressed")).toBe(false);
    expect(control("move-up").dataset.available).toBe("false");
    expect(control("move-up").getAttribute("aria-disabled")).toBe("true");
    expect(control("overview").getAttribute("aria-keyshortcuts")).toBe("Alt+O");
    expect(control("overview").getAttribute("aria-pressed")).toBe("false");

    await act(async () => control("move-up").click());
    expect(workspace.getSnapshot().focusedPaneId).toBe("source");
    await act(async () => control("move-right").click());
    expect(workspace.getSnapshot().focusedPaneId).toBe("right");
    await act(async () => control("overview").click());
    expect(workspace.getSnapshot().presentationMode).toBe("overview");
    expect(control("overview").getAttribute("aria-pressed")).toBe("true");
    expect(control("overview").getAttribute("aria-label")).toBe(
      "Exit workspace overview",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("ports desktop controls into host chrome while compact controls stay in the workspace", async () => {
    const container = document.createElement("div");
    const controlsHost = document.createElement("div");
    document.body.append(container, controlsHost);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          classNames={{ "desktop-controls": "host-desktop-controls" }}
          compactBreakpoint={0}
          desktopControlsContainer={controlsHost}
          initialPanes={twoDimensionalPanes()}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
          tokens={{ "--onirigiri-control-size": "29px" }}
        />,
      );
    });

    const workspace = requiredElement<HTMLElement>(
      container,
      ".onirigiri-workspace",
    );
    const desktopControls = requiredElement<HTMLElement>(
      controlsHost,
      '[data-onirigiri-slot="desktop-controls"]',
    );
    const desktopToolbar = requiredElement<HTMLElement>(
      desktopControls,
      '[role="group"][aria-label="Workspace controls"]',
    );

    expect(workspace.querySelector(".onirigiri-workspace__toolbar")).toBeNull();
    expect([...desktopControls.classList]).toEqual(
      expect.arrayContaining([
        "onirigiri-workspace__desktop-controls",
        "host-desktop-controls",
      ]),
    );
    expect(
      desktopControls.style.getPropertyValue("--onirigiri-control-size"),
    ).toBe("29px");
    expect(desktopToolbar.dataset.layout).toBe("desktop");
    await act(async () =>
      requiredElement<HTMLButtonElement>(
        desktopToolbar,
        'button[aria-label="Move cursor right"]',
      ).click(),
    );
    expect(
      requiredWorkspaceHandle(workspaceRef.current).getSnapshot().focusedPaneId,
    ).toBe("right");

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          compactBreakpoint={Number.POSITIVE_INFINITY}
          desktopControlsContainer={controlsHost}
          initialPanes={twoDimensionalPanes()}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });

    expect(
      controlsHost.querySelector(".onirigiri-workspace__toolbar"),
    ).toBeNull();
    expect(
      requiredElement<HTMLElement>(workspace, ".onirigiri-workspace__toolbar")
        .dataset.layout,
    ).toBe("compact");

    await act(async () => root.unmount());
    container.remove();
    controlsHost.remove();
  });

  it("applies the stable styling contract through framework-neutral adapters", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    function DesignSystemButton(
      props: ButtonHTMLAttributes<HTMLButtonElement>,
    ) {
      return <button data-design-system="test" {...props} />;
    }

    const renderStyledWorkspace = (willChange: string) => (
      <OnirigiriWorkspace
        chromeComponents={{
          PaneActionButton: ({ action: _action, ...props }) => (
            <DesignSystemButton {...props} />
          ),
          WorkspaceControlButton: ({ control: _control, ...props }) => (
            <DesignSystemButton {...props} />
          ),
        }}
        className="host-root"
        classNames={{
          control: "host-control",
          pane: "host-pane",
          "pane-action": "host-pane-action",
          stage: "host-stage",
          workspace: "host-workspace-slot",
        }}
        initialPanes={[
          { paneId: "source", surfaceKind: "test", title: "Source" },
        ]}
        renderPane={() => <div>Test content</div>}
        styles={{
          control: { borderRadius: "11px" },
          pane: {
            backgroundColor: "rgb(1, 2, 3)",
            transform: "none",
            willChange,
          },
        }}
        tokens={{ "--onirigiri-control-size": "31px" }}
      />
    );

    await act(async () => {
      root.render(renderStyledWorkspace("contents"));
    });

    const workspace = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="workspace"]',
    );
    const stage = requiredElement<HTMLElement>(
      workspace,
      '[data-onirigiri-slot="stage"]',
    );
    const pane = requiredElement<HTMLElement>(
      workspace,
      '[data-onirigiri-slot="pane"]',
    );
    const control = requiredElement<HTMLButtonElement>(
      workspace,
      '[data-onirigiri-slot="control"]',
    );
    const paneAction = requiredElement<HTMLButtonElement>(
      workspace,
      '[data-onirigiri-slot="pane-action"]',
    );

    expect(workspace.getAttribute("role")).toBe("region");
    expect(workspace.dataset.onirigiriStylingVersion).toBe("9");
    expect([...workspace.classList]).toEqual(
      expect.arrayContaining([
        "onirigiri-workspace",
        "host-workspace-slot",
        "host-root",
      ]),
    );
    expect(workspace.style.getPropertyValue("--onirigiri-control-size")).toBe(
      "31px",
    );
    expect([...stage.classList]).toEqual(
      expect.arrayContaining(["onirigiri-workspace__stage", "host-stage"]),
    );
    expect([...pane.classList]).toEqual(
      expect.arrayContaining(["onirigiri-pane", "host-pane"]),
    );
    expect(pane.style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(pane.style.transform).toMatch(/^translate(?:3d)?\(/);
    expect(pane.style.willChange).toBe("contents");
    expect([...control.classList]).toEqual(
      expect.arrayContaining(["onirigiri-workspace__control", "host-control"]),
    );
    expect(control.dataset.designSystem).toBe("test");
    expect(control.getAttribute("aria-label")).toBeTruthy();
    expect(control.type).toBe("button");
    expect(control.style.borderRadius).toBe("11px");
    expect([...paneAction.classList]).toEqual(
      expect.arrayContaining(["onirigiri-pane__action", "host-pane-action"]),
    );
    expect(paneAction.dataset.designSystem).toBe("test");

    await act(async () => {
      root.render(renderStyledWorkspace("scroll-position"));
    });
    expect(pane.style.willChange).toBe("scroll-position");

    await act(async () => root.unmount());
    container.remove();
  });
});

function twoDimensionalPanes() {
  return [
    {
      columnId: "source-column",
      paneId: "source",
      planeIndex: 0,
      slotIndex: 0,
      surfaceKind: "test",
      title: "Source",
    },
    {
      columnId: "right-column",
      paneId: "right",
      planeIndex: 0,
      slotIndex: 1,
      surfaceKind: "test",
      title: "Right",
    },
    {
      columnId: "lower-column",
      paneId: "lower",
      planeIndex: 1,
      slotIndex: 0,
      surfaceKind: "test",
      title: "Lower",
    },
  ];
}

function fixedWidthPanes(count: number, width = 520) {
  return Array.from({ length: count }, (_, index) => ({
    columnWidth: { unit: "px" as const, value: width },
    paneId: `pane-${index + 1}`,
    surfaceKind: "test",
    title: `Pane ${index + 1}`,
  }));
}

function paneHeights(
  scene: ReturnType<OnirigiriWorkspaceHandle["getScene"]>,
): Array<number | undefined> {
  return scene.panes.map((pane) => paneHeight(scene, pane.paneId));
}

function paneHeight(
  scene: ReturnType<OnirigiriWorkspaceHandle["getScene"]>,
  paneId: string,
): number | undefined {
  return paneCellSizingForPane(scene, paneId)?.heightPx;
}

function StatefulTestPane({ paneId }: { paneId: string }) {
  const [count, setCount] = useState(0);
  return (
    <button
      data-counter={paneId}
      onClick={() => setCount((value) => value + 1)}
      type="button"
    >
      {count}
    </button>
  );
}

function dispatchPointerDown(target: Element): boolean {
  return target.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true,
    }),
  );
}

async function pressKey(target: HTMLElement, key: string): Promise<void> {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
    ),
  );
}
