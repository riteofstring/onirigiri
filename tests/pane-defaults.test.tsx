// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceScene,
  OnirigiriLayoutEngine,
  OnirigiriLayoutStore,
  OnirigiriWorkspace,
  serializeWorkspaceLayout,
  type OnirigiriWorkspaceHandle,
  type OnirigiriWorkspaceProps,
  type PaneRenderItem,
  type Rect,
  type WorkspaceLayoutSnapshot,
  type WorkspaceSceneOptions,
} from "../src/index";
import { paneSizingTargets } from "../src/layout/pane-sizing";
import type { PaneSizingMode } from "../src/types";
import { stubOnirigiriWorkspaceBrowserGlobals } from "./onirigiri-workspace-test-support";

const viewport = { x: 0, y: 0, width: 1200, height: 900 };
const video = { paneId: "video", surfaceKind: "video", title: "Video" };

function workspace(options: WorkspaceSceneOptions = {}) {
  const { scene, cursor } = createWorkspaceScene({
    panes: [video],
    ...options,
  });
  const engine = new OnirigiriLayoutEngine(scene);
  return { engine, store: new OnirigiriLayoutStore(engine, scene, cursor) };
}

function box(
  engine: OnirigiriLayoutEngine,
  size: Rect = viewport,
  paneId = "video",
) {
  const result = engine
    .paneWorldBoxes(size)
    .find((pane) => pane.paneId === paneId);
  if (!result) throw new Error(`Missing pane ${paneId}`);
  return result;
}

function renderedCursor(
  engine: OnirigiriLayoutEngine,
  snapshot: WorkspaceLayoutSnapshot,
  moving = false,
) {
  return engine.gridCursorRenderItem({
    cursor: snapshot.cursor,
    focusedPaneId: snapshot.focusedPaneId,
    horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
    maximizedPaneId: snapshot.maximizedPaneId,
    movementPhase: moving ? "moving" : "idle",
    presentationMode: "normal",
    scrollColumn: snapshot.scrollColumn,
    scrollRow: snapshot.scrollRow,
    verticalAnchorOffset: snapshot.verticalAnchorOffset,
    viewport,
  });
}

describe("pane type defaults", () => {
  it("preserves explicit widths when moving into empty cells and back", () => {
    const { engine } = workspace({
      paneDefaults: { width: 480 },
      panes: [{ ...video, columnWidth: { unit: "px", value: 430 } }],
    });
    const initial = box(engine);
    expect(engine.movePane("video", "right")).toBe(true);
    expect(box(engine).width).toBe(430);
    expect(engine.movePane("video", "left")).toBe(true);
    expect(box(engine)).toMatchObject({ x: initial.x, width: initial.width });
  });

  it("resolves workspace, type and pane preferences with preferred aspect ratios", () => {
    const { engine } = workspace({
      paneDefaults: { width: 420 },
      paneTypeDefaults: { video: { width: 800, aspectRatio: 16 / 9 } },
      panes: [
        video,
        { ...video, paneId: "custom", defaults: { width: 640 } },
        { paneId: "notes", surfaceKind: "notes", title: "Notes" },
      ],
    });
    expect(box(engine)).toMatchObject({ width: 800, height: 450 });
    expect(box(engine, viewport, "custom")).toMatchObject({
      width: 640,
      height: 360,
    });
    expect(box(engine, viewport, "notes")).toMatchObject({
      width: 420,
      height: 880,
    });
  });

  it("lets a type derive width from full-height content through a JSON auto override", () => {
    const { engine } = workspace(
      JSON.parse(
        '{"paneDefaults":{"width":480,"height":"viewport"},"paneTypeDefaults":{"video":{"width":"auto","aspectRatio":2}}}',
      ),
    );
    expect(box(engine, { ...viewport, width: 2400 })).toMatchObject({
      width: 1760,
      height: 880,
    });
    expect(box(engine)).toMatchObject({ width: 1180, height: 880 });
  });

  it("fits a preferred portrait ratio inside a shorter viewport", () => {
    const { engine } = workspace({
      paneDefaults: { width: 1000, aspectRatio: 0.5 },
    });
    expect(box(engine)).toMatchObject({ width: 440, height: 880 });
    expect(box(engine, { ...viewport, width: 400, height: 900 })).toMatchObject(
      { width: 380, height: 760 },
    );
  });

  it("allows developer minimums below the ordinary pane size", () => {
    const { engine } = workspace({
      paneDefaults: { width: 64, height: 32, minWidth: 32, minHeight: 24 },
    });
    expect(box(engine)).toMatchObject({ width: 64, height: 32 });
  });

  it("clamps oversized preferred sizes and minimums while preserving the requested dimensions", () => {
    const { engine } = workspace({
      paneTypeDefaults: {
        video: { width: 3840, height: 2160, minWidth: 3000, minHeight: 1800 },
      },
    });
    expect(box(engine, { ...viewport, width: 800, height: 600 })).toMatchObject(
      { width: 780, height: 580 },
    );
    expect(
      box(engine, { ...viewport, width: 5000, height: 3000 }),
    ).toMatchObject({ width: 3840, height: 2160 });
    expect(engine.toScene().paneTypeDefaults?.video?.width).toBe(3840);
  });

  it("applies developer maximums and uses the viewport when minimums cannot fit", () => {
    const { engine } = workspace({
      paneDefaults: {
        width: 2400,
        height: 1600,
        minWidth: 1600,
        maxWidth: 1800,
        minHeight: 1000,
        maxHeight: 1200,
      },
    });
    expect(
      box(engine, { ...viewport, width: 3000, height: 2000 }),
    ).toMatchObject({ width: 1800, height: 1200 });
    expect(box(engine, { ...viewport, width: 800, height: 600 })).toMatchObject(
      { width: 780, height: 580 },
    );
  });

  it("fills both viewport dimensions and shares viewport height between stacked panes", () => {
    const { engine } = workspace({
      paneDefaults: { width: "viewport", height: "viewport" },
    });
    expect(box(engine)).toMatchObject({ width: 1180, height: 880 });
    const stacked = workspace({
      paneDefaults: { width: 500, height: "viewport" },
      panes: [
        { ...video, columnId: "stack" },
        { ...video, paneId: "lower", columnId: "stack", weight: 2 },
      ],
    }).engine;
    const upper = box(stacked);
    const lower = box(stacked, viewport, "lower");
    expect(upper.height + lower.height).toBe(872);
    expect(lower.height).toBeCloseTo(upper.height * 2);
    expect(lower.y - upper.y - upper.height).toBeCloseTo(8);
  });

  it("honors explicit initial geometry and constrains manual resizing on both axes", () => {
    const { engine, store } = workspace({
      paneDefaults: {
        width: 640,
        aspectRatio: 2,
        minWidth: 300,
        maxWidth: 700,
        minHeight: 150,
        maxHeight: 500,
      },
      panes: [
        { ...video, columnWidth: { unit: "px", value: 600 }, heightPx: 260 },
      ],
    });
    expect(box(engine)).toMatchObject({ width: 600, height: 260 });
    store.resizePaneColumn("video", { unit: "px", value: 1800 });
    store.resizePaneRow("video", 1300);
    expect(box(engine)).toMatchObject({ width: 700, height: 500 });
    store.resizePaneColumn("video", { unit: "px", value: 180 });
    store.resizePaneRow("video", 96);
    expect(box(engine)).toMatchObject({ width: 300, height: 150 });
    store.resetWorkspaceSizing(viewport);
    expect(box(engine)).toMatchObject({ width: 640, height: 320 });
  });

  it("lets a maximized pane fill the viewport despite pane size limits and restores the limits", () => {
    const tall = { ...viewport, width: 1600, height: 1300 };
    const limits = { maxHeight: 900, maxWidth: 1000, minWidth: 300 };
    const { engine, store } = workspace({
      paneDefaults: limits,
      panes: [
        { ...video, columnId: "stack" },
        { ...video, paneId: "lower", columnId: "stack" },
        { ...video, paneId: "side" },
      ],
    });
    const maximized = () =>
      engine
        .paneWorldBoxes(tall, store.getSnapshot().maximizedPaneId)
        .find((pane) => pane.paneId === "video");
    const limited = maximized();
    expect(limited!.width).toBeLessThanOrEqual(1000);
    expect(limited!.height).toBeLessThanOrEqual(900);

    store.togglePaneMaximized("video");
    expect(maximized()).toMatchObject({ width: 1580, height: 1280 });

    store.togglePaneMaximized("video");
    expect(maximized()).toEqual(limited);
  });

  it("fills the viewport for full sizing despite pane size limits until another sizing mode", () => {
    const tall = { ...viewport, width: 1600, height: 1100 };
    const { engine, store } = workspace({
      paneDefaults: { maxHeight: 900, maxWidth: 1000, minHeight: 400 },
      panes: [video, { ...video, paneId: "side" }],
    });
    const resize = (mode: Exclude<PaneSizingMode, "default">) =>
      store.resizePanes(
        paneSizingTargets({
          currentSizes: [],
          mode,
          scene: store.toScene(),
          viewport: tall,
          workspace: null,
        }),
        tall,
        mode,
      );

    resize("full");
    expect(box(engine, tall)).toMatchObject({ width: 1580, height: 1080 });
    expect(box(engine, tall, "side")).toMatchObject({
      width: 1580,
      height: 1080,
    });

    resize("minimum");
    expect(box(engine, tall).height).toBe(400);

    resize("full");
    store.resetWorkspaceSizing(tall);
    expect(box(engine, tall).width).toBeLessThanOrEqual(1000);
    expect(box(engine, tall).height).toBeLessThanOrEqual(900);
  });

  it("lets stacked dividers override preferred aspect-ratio heights", () => {
    const { engine, store } = workspace({
      paneTypeDefaults: { video: { width: 640, aspectRatio: 2 } },
      panes: [
        { ...video, columnId: "stack" },
        { ...video, paneId: "lower", columnId: "stack" },
      ],
    });
    store.ensureFocusedPaneVisible(viewport);
    expect(box(engine).height).toBe(320);
    store.resizePaneSplit("video", "lower", 1.5, 0.5);
    expect(box(engine).height).toBe(480);
    expect(box(engine, viewport, "lower").height).toBe(160);
    store.resizePaneSplit("video", "lower", 0.5, 1.5);
    expect(box(engine).height).toBe(160);
    expect(box(engine, viewport, "lower").height).toBe(480);
  });

  it("stops a divider at type bounds while preserving the combined height", () => {
    const { engine, store } = workspace({
      paneTypeDefaults: {
        video: { width: 640, height: 300, minHeight: 200, maxHeight: 400 },
      },
      panes: [
        { ...video, columnId: "stack" },
        { ...video, paneId: "lower", columnId: "stack" },
      ],
    });
    store.ensureFocusedPaneVisible(viewport);
    store.resizePaneSplit("video", "lower", 1.9, 0.1);
    expect(box(engine).height).toBe(400);
    expect(box(engine, viewport, "lower").height).toBe(200);
    store.resizePaneSplit("video", "lower", 0.1, 1.9);
    expect(box(engine).height).toBe(200);
    expect(box(engine, viewport, "lower").height).toBe(400);
  });

  it("applies type defaults to new and reconfigured panes and keeps them after restoration", () => {
    const configuration = {
      paneTypeDefaults: {
        video: { width: 640, aspectRatio: 2 },
        notes: { width: 360, height: 500 },
      },
    };
    const { engine, store } = workspace(configuration);
    const paneId = store.openPane({ surfaceKind: "notes", title: "New notes" });
    expect(box(engine, viewport, paneId)).toMatchObject({
      width: 360,
      height: 500,
    });
    store.configurePane(paneId, {
      surfaceKind: "video",
      defaults: { width: 720 },
    });
    expect(box(engine, viewport, paneId)).toMatchObject({
      width: 720,
      height: 360,
    });
    store.resizePaneColumn(paneId, { unit: "px", value: 900 });
    const layout = serializeWorkspaceLayout(
      store.toScene(),
      store.getSnapshot().cursor,
    );
    store.restoreLayout(layout);
    expect(box(engine, viewport, paneId)).toMatchObject({
      width: 900,
      height: 450,
    });
    const restored = workspace({ ...configuration, initialLayout: layout });
    expect(box(restored.engine, viewport, paneId)).toMatchObject({
      width: 900,
      height: 450,
    });
    expect(box(restored.engine, viewport, "video")).toMatchObject({
      width: 640,
      height: 320,
    });
  });

  it("keeps overview and grid focus aligned with the sized panes", () => {
    const { engine } = workspace({
      paneTypeDefaults: { video: { width: 640, aspectRatio: 2 } },
    });
    const expected = box(engine);
    expect(
      engine.gridCellBox({ column: 0, row: 0, split: 0 }, viewport),
    ).toMatchObject({ width: 640, height: 320, x: expected.x, y: expected.y });
    const items: PaneRenderItem[] = [];
    engine.renderFrame(
      {
        focusedPaneId: "video",
        maximizedPaneId: null,
        movementPhase: "idle",
        presentationMode: "overview",
        scrollColumn: 0,
        scrollRow: 0,
        viewport,
      },
      (item) => items.push(item),
    );
    expect(items[0]).toMatchObject({ width: 640, height: 320 });
  });

  it("keeps repeated default plane additions within camera reach", () => {
    const { engine, store } = workspace();
    const paneIds = ["video"];
    let paneId = "video";

    for (let row = 1; row <= 10; row += 1) {
      paneId = store.splitPaneToPlane(paneId, "down");
      paneIds.push(paneId);
    }

    for (const [row, candidatePaneId] of paneIds.entries()) {
      expect(store.focusPane(candidatePaneId)).toBe(true);
      store.ensureFocusedPaneVisible(viewport);
      store.snapAnimationsToTarget();
      const snapshot = store.getSnapshot();
      const selected = engine.gridCellBox(snapshot.cursor, viewport);
      expect(snapshot).toMatchObject({
        cursor: { row },
        focusedPaneId: candidatePaneId,
      });
      const rendered = renderedCursor(engine, snapshot);
      expect(rendered).toMatchObject({
        height: selected.height,
        paneId: candidatePaneId,
      });
      expect(rendered.y + rendered.height / 2).toBeCloseTo(
        viewport.height / 2,
        6,
      );
    }
  });

  it("keeps adjacent safe-integer edge cells visually distinct", () => {
    const edge = Number.MAX_SAFE_INTEGER;
    const source = createWorkspaceScene({
      panes: [
        {
          ...video,
          columnId: "upper-left",
          paneId: "upper-left",
        },
        {
          ...video,
          columnId: "upper-right",
          paneId: "upper-right",
        },
        {
          ...video,
          columnId: "lower-left",
          paneId: "lower-left",
        },
      ],
    });
    const layout = serializeWorkspaceLayout(source.scene, source.cursor);
    for (const column of layout.columns) {
      if (column.columnId === "upper-left") {
        column.planeIndex = edge - 1;
        column.slotIndex = edge - 1;
      } else if (column.columnId === "upper-right") {
        column.planeIndex = edge - 1;
        column.slotIndex = edge;
      } else {
        column.planeIndex = edge;
        column.slotIndex = edge - 1;
      }
    }
    layout.cursor = { column: edge - 1, row: edge - 1, split: 0 };
    const { scene } = createWorkspaceScene({ initialLayout: layout });
    const engine = new OnirigiriLayoutEngine(scene);
    const cursor = { column: edge - 1, row: edge - 1, split: 0 };
    const camera = engine.gridCameraTarget(cursor, viewport, "center");
    const items: PaneRenderItem[] = [];

    engine.renderFrame(
      {
        ...camera,
        cursor,
        focusedPaneId: "upper-left",
        maximizedPaneId: null,
        movementPhase: "idle",
        presentationMode: "normal",
        viewport,
      },
      (item) => items.push(item),
    );

    const upperLeft = items.find((item) => item.paneId === "upper-left");
    const upperRight = items.find((item) => item.paneId === "upper-right");
    const lowerLeft = items.find((item) => item.paneId === "lower-left");
    expect(upperLeft).toBeDefined();
    expect(upperRight).toBeDefined();
    expect(lowerLeft).toBeDefined();
    const upperLeftCell = engine.gridCellBox(cursor, viewport);
    const upperRightCell = engine.gridCellBox(
      { ...cursor, column: edge },
      viewport,
    );
    const lowerLeftCell = engine.gridCellBox(
      { ...cursor, row: edge },
      viewport,
    );
    expect(upperRightCell.x).toBeCloseTo(
      upperLeftCell.x + upperLeftCell.width + scene.columnGap,
      6,
    );
    expect(lowerLeftCell.y).toBeGreaterThan(
      upperLeftCell.y + upperLeftCell.height,
    );
    expect(upperRight!.x).toBeCloseTo(
      upperLeft!.x + upperLeft!.width + scene.columnGap,
      6,
    );
    expect(lowerLeft!.y).toBeGreaterThan(upperLeft!.y + upperLeft!.height);
    expect(
      engine.gridCursorRenderItem({
        ...camera,
        cursor,
        focusedPaneId: "upper-left",
        maximizedPaneId: null,
        movementPhase: "idle",
        presentationMode: "normal",
        viewport,
      }),
    ).toMatchObject({
      x: viewport.width / 2 - upperLeft!.width / 2,
      y: viewport.height / 2 - upperLeft!.height / 2,
    });

    const store = new OnirigiriLayoutStore(engine, scene, cursor);
    store.ensureFocusedPaneVisible(viewport);
    store.snapAnimationsToTarget();
    expect(store.moveFocus("right", viewport)).toBe(true);
    const horizontalRequest = store.getSnapshot();
    const horizontalStart = renderedCursor(engine, horizontalRequest, true);
    expect(horizontalRequest.scrollColumn).toBe(edge - 1);
    expect(horizontalRequest.targetScrollColumn).toBe(edge);
    expect(store.advanceFrame(16)).toBe("moving");
    const horizontalFrame = store.getSnapshot();
    const horizontalMoving = renderedCursor(engine, horizontalFrame, true);
    expect(horizontalMoving.x).toBeLessThan(horizontalStart.x);
    expect(horizontalMoving.x).toBeCloseTo(
      viewport.width / 2 - horizontalMoving.width / 2,
      6,
    );
    expect(store.advanceFrame(16)).toBe("idle");

    store.snapAnimationsToTarget();
    expect(store.moveFocus("down", viewport)).toBe(true);
    const verticalRequest = store.getSnapshot();
    const verticalStart = renderedCursor(engine, verticalRequest, true);
    expect(verticalRequest.scrollRow).toBe(edge - 1);
    expect(verticalRequest.targetScrollRow).toBe(edge);
    expect(store.advanceFrame(16)).toBe("moving");
    const verticalFrame = store.getSnapshot();
    const verticalMoving = renderedCursor(engine, verticalFrame, true);
    expect(verticalMoving.y).toBeLessThan(verticalStart.y);
    expect(verticalMoving.y).toBeCloseTo(
      viewport.height / 2 - verticalMoving.height / 2,
      6,
    );
    expect(store.advanceFrame(16)).toBe("idle");
  });

  it("shares a constrained width across grid slots with different content types", () => {
    const { engine } = workspace({
      paneTypeDefaults: {
        video: { width: 800, minWidth: 700 },
        notes: { width: 420, maxWidth: 500 },
      },
      panes: [
        { ...video, slotIndex: 0 },
        {
          paneId: "notes",
          title: "Notes",
          surfaceKind: "notes",
          planeIndex: 1,
          slotIndex: 0,
        },
      ],
    });
    expect(box(engine).width).toBe(500);
    expect(box(engine, viewport, "notes").width).toBe(500);
  });

  it("clamps even extremely small compact viewports", () => {
    const { engine } = workspace({
      paneDefaults: {
        width: 3840,
        height: 2160,
        minWidth: 1600,
        minHeight: 900,
      },
    });
    engine.setCompactLayout(true);
    expect(box(engine, { ...viewport, width: 50, height: 30 })).toMatchObject({
      width: 50,
      height: 30,
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid size and ratio %s",
    (value) => {
      expect(() => workspace({ paneDefaults: { width: value } })).toThrow(
        "positive finite",
      );
      expect(() =>
        workspace({
          panes: [{ ...video, defaults: { content: { aspectRatio: value } } }],
        }),
      ).toThrow("positive finite");
    },
  );
});

describe("React pane defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("updates preferences and content fit without remounting edited content", async () => {
    stubOnirigiriWorkspaceBrowserGlobals();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const handle = createRef<OnirigiriWorkspaceHandle>();
    const renderPane = vi.fn<OnirigiriWorkspaceProps["renderPane"]>(
      (_pane, state) => <input defaultValue={state.content?.fit ?? "unset"} />,
    );
    const render = async (width: number, fit: "contain" | "cover") =>
      act(async () =>
        root.render(
          <OnirigiriWorkspace
            ref={handle}
            initialPanes={[video]}
            paneDefaults={{
              width,
              height: 400,
              content: { aspectRatio: 16 / 9 },
            }}
            paneTypeDefaults={{ video: { content: { fit } } }}
            renderPane={renderPane}
          />,
        ),
      );
    try {
      await render(500, "contain");
      const field = container.querySelector("input")!;
      field.value = "Keep this edit";
      expect(
        container.querySelector<HTMLElement>('[data-onirigiri-pane-id="video"]')
          ?.style.width,
      ).toBe("500px");
      await render(700, "cover");
      expect(container.querySelector("input")).toBe(field);
      expect(field.value).toBe("Keep this edit");
      expect(
        container.querySelector<HTMLElement>('[data-onirigiri-pane-id="video"]')
          ?.style.width,
      ).toBe("700px");
      expect(renderPane.mock.lastCall?.[1].content).toEqual({
        fit: "cover",
        aspectRatio: 16 / 9,
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("updates a cursor runway without remounting pane content and returns home", async () => {
    stubOnirigiriWorkspaceBrowserGlobals();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const handle = createRef<OnirigiriWorkspaceHandle>();
    const render = async (cursorRunway: number) =>
      act(async () => {
        root.render(
          <OnirigiriWorkspace
            cursorRunway={cursorRunway}
            initialPanes={[
              { paneId: "home", surfaceKind: "test", title: "Home" },
            ]}
            ref={handle}
            renderPane={() => <div>Home content</div>}
          />,
        );
      });
    try {
      await render(1);
      const workspace = handle.current;
      if (!workspace) throw new Error("Missing workspace handle");
      const homePane = container.querySelector(
        '[data-onirigiri-pane-id="home"]',
      );
      expect(homePane).not.toBeNull();
      let movementResults: boolean[] = [];
      await act(async () => {
        movementResults = [workspace.focus("left"), workspace.focus("left")];
      });
      expect(movementResults).toEqual([true, false]);

      await render(2);
      expect(container.querySelector('[data-onirigiri-pane-id="home"]')).toBe(
        homePane,
      );
      let returnedHome = false;
      await act(async () => {
        movementResults = [workspace.focus("left"), workspace.focus("left")];
        returnedHome = workspace.returnHome();
      });
      expect(movementResults).toEqual([true, false]);
      expect(returnedHome).toBe(true);
      expect(workspace.getSnapshot()).toMatchObject({
        cursor: { column: 0, row: 0, split: 0 },
        focusedPaneId: "home",
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
