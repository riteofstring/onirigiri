import { describe, expect, it } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
} from "../src/workspace/workspace-scene";
import type { PaneRenderItem } from "../src/types";

const desktopViewport = { height: 900, width: 1200, x: 0, y: 0 };

describe("workspace grid geometry", () => {
  it("resolves occupied, reserved, split, and virtual empty cells without materializing runway columns", () => {
    const { engine, scene } = geometryHarness();

    const top = engine.gridCellBox(
      { column: 0, row: 0, split: 0 },
      desktopViewport,
    );
    const bottom = engine.gridCellBox(
      { column: 0, row: 0, split: 1 },
      desktopViewport,
    );
    const emptySlot = engine.gridCellBox(
      { column: 1, row: 0, split: 0 },
      desktopViewport,
    );
    const far = engine.gridCellBox(
      { column: 2, row: 0, split: 0 },
      desktopViewport,
    );
    const reserved = engine.gridCellBox(
      { column: 3, row: 0, split: 0 },
      desktopViewport,
    );
    const emptyRow = engine.gridCellBox(
      { column: -1, row: -1, split: 0 },
      desktopViewport,
    );

    expect(top).toMatchObject({
      kind: "occupied",
      paneId: "top",
      structural: true,
    });
    expect(bottom).toMatchObject({
      kind: "occupied",
      paneId: "bottom",
      structural: true,
    });
    expect(bottom.y).toBeCloseTo(top.y + top.height + scene.rowGap, 6);
    expect(emptySlot).toMatchObject({
      kind: "empty",
      paneId: null,
      structural: false,
    });
    expect(reserved).toMatchObject({
      kind: "reserved",
      paneId: null,
      structural: true,
    });
    expect(emptyRow).toMatchObject({
      kind: "empty",
      paneId: null,
      structural: false,
    });
    expect(emptySlot.x).toBeCloseTo(top.x + top.width + scene.columnGap, 6);
    expect(far.x).toBeCloseTo(
      emptySlot.x + emptySlot.width + scene.columnGap,
      6,
    );
    expect(reserved.x).toBeCloseTo(far.x + far.width + scene.columnGap, 6);
    expect(emptyRow.x + emptyRow.width + scene.columnGap).toBeCloseTo(top.x, 6);
    expect(emptyRow.y).toBeLessThan(top.y);
    expect(scene.columns).toHaveLength(3);
  });

  it("maps the selected split or empty cell through normal and overview presentation geometry", () => {
    const { engine, scene } = geometryHarness();
    const cursor = { column: 0, row: 0, split: 1 };
    const normal = engine.gridCursorRenderItem({
      cursor,
      focusedPaneId: "bottom",
      maximizedPaneId: null,
      movementPhase: "idle",
      presentationMode: "normal",
      scrollColumn: 0,
      scrollRow: 0,
      viewport: desktopViewport,
    });
    const normalCell = engine.gridCellBox(cursor, desktopViewport);

    expect(normal).toMatchObject({
      height: normalCell.height,
      kind: "occupied",
      paneId: "bottom",
      scale: 1,
      width: normalCell.width,
      x: normalCell.x,
      y: normalCell.y,
    });

    const overviewItems: PaneRenderItem[] = [];
    const overviewInput = {
      cursor,
      focusedPaneId: "bottom",
      maximizedPaneId: null,
      movementPhase: "idle" as const,
      overviewZoom: 1,
      presentationMode: "overview" as const,
      scrollColumn: 0,
      scrollRow: 0,
      viewport: desktopViewport,
    };
    engine.renderFrame(overviewInput, (item) => overviewItems.push(item));
    const overview = engine.gridCursorRenderItem(overviewInput);
    const bottom = overviewItems.find((item) => item.paneId === "bottom");
    if (!bottom) {
      throw new Error("missing selected overview pane");
    }

    expect(overview).toMatchObject({
      height: bottom.height,
      kind: "occupied",
      paneId: "bottom",
      scale: bottom.scale,
      width: bottom.width,
      x: bottom.x,
    });
    expect(overview.y).toBeCloseTo(bottom.y, 6);

    const empty = engine.gridCursorRenderItem({
      ...overviewInput,
      cursor: { column: 1, row: 0, split: 0 },
      focusedPaneId: null,
    });
    expect(empty).toMatchObject({
      kind: "empty",
      paneId: null,
      structural: false,
    });
    expect(engine.toScene().columns).toHaveLength(scene.columns.length);
  });

  it("keeps virtual cells in a resized split row on the logical row height", () => {
    const source = createWorkspaceScene({
      panes: [
        {
          columnId: "stack",
          columnWidth: { unit: "px", value: 320 },
          heightPx: 180,
          paneId: "top",
          slotIndex: 0,
          surfaceKind: "test",
          title: "Top",
        },
      ],
    });
    const layout = serializeWorkspaceLayout(source.scene, source.cursor);
    const stack = layout.columns.find((column) => column.columnId === "stack");
    if (!stack) {
      throw new Error("missing stack column");
    }
    stack.cells = [
      { heightPx: 180, paneId: "top", reserved: false, weight: 1 },
      { heightPx: 120, paneId: null, reserved: true, weight: 1 },
    ];
    const restored = createWorkspaceScene({ initialLayout: layout });
    const engine = new WorkspaceLikeLayoutEngine(restored.scene);
    const occupied = engine.gridCellBox(
      { column: 0, row: 0, split: 0 },
      desktopViewport,
    );
    const reserved = engine.gridCellBox(
      { column: 0, row: 0, split: 1 },
      desktopViewport,
    );
    const virtual = engine.gridCellBox(
      { column: 1, row: 0, split: 0 },
      desktopViewport,
    );

    expect(reserved).toMatchObject({ kind: "reserved", height: 120 });
    expect(reserved.y).toBeCloseTo(
      occupied.y + occupied.height + restored.scene.rowGap,
      6,
    );
    expect(virtual).toMatchObject({ kind: "empty", structural: false });
    expect(virtual.height).toBeCloseTo(
      occupied.height + restored.scene.rowGap + reserved.height,
      6,
    );
    expect(
      engine.gridCursorRenderItem({
        cursor: virtual.cursor,
        focusedPaneId: null,
        maximizedPaneId: null,
        movementPhase: "idle",
        presentationMode: "normal",
        scrollColumn: 0,
        scrollRow: 0,
        viewport: desktopViewport,
      }).height,
    ).toBeCloseTo(virtual.height, 6);
    expect(
      engine.gridCursorRenderItem({
        cursor: virtual.cursor,
        focusedPaneId: null,
        maximizedPaneId: null,
        movementPhase: "idle",
        presentationMode: "overview",
        scrollColumn: 0,
        scrollRow: 0,
        viewport: desktopViewport,
      }).height,
    ).toBeCloseTo(virtual.height, 6);
  });

  it("targets distant signed coordinates without camera clamping", () => {
    const { engine } = geometryHarness();
    const positive = engine.gridCameraTarget(
      { column: 1_000_000, row: 1_000_000, split: 0 },
      desktopViewport,
      "center",
    );
    const negative = engine.gridCameraTarget(
      { column: -1_000_000, row: -1_000_000, split: 0 },
      desktopViewport,
      "center",
    );

    expect(positive.scrollColumn).toBe(1_000_000);
    expect(positive.scrollRow).toBeGreaterThan(0);
    expect(negative.scrollColumn).toBe(-1_000_000);
    expect(negative.scrollRow).toBeLessThan(0);
    expect(
      engine.gridCellBox(
        { column: 1_000_000, row: -1_000_000, split: 0 },
        desktopViewport,
      ),
    ).toMatchObject({ kind: "empty", structural: false });
  });

  it("retargets split traversal through an empty row with the selected cell centered", () => {
    const { engine, scene } = geometryHarness();
    const store = new WorkspaceLayoutStore(
      engine,
      scene,
      { column: 0, row: 0, split: 0 },
      { initialFocusAnchor: "center" },
    );

    store.ensureFocusedPaneVisible(desktopViewport);
    expect(store.moveFocus("down", desktopViewport)).toBe(true);
    store.snapAnimationsToTarget();
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 0, row: 0, split: 1 },
      focusedPaneId: "bottom",
    });
    expectCursorCellCentered(engine, store);

    expect(store.moveFocus("down", desktopViewport)).toBe(true);
    store.snapAnimationsToTarget();
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 0, row: 1, split: 0 },
      focusedPaneId: null,
    });
    expectCursorCellCentered(engine, store);
  });

  it("centers the initial or restored cursor with the default center anchor", () => {
    const source = createWorkspaceScene({
      panes: [pane("origin", "origin", 0, 0)],
    });
    const initialEngine = new WorkspaceLikeLayoutEngine(source.scene);
    const initialStore = new WorkspaceLayoutStore(
      initialEngine,
      source.scene,
      source.cursor,
    );

    initialStore.ensureFocusedPaneVisible(desktopViewport);
    expect(initialStore.getSnapshot().focusAnchor).toBe("center");
    expectCursorCellCentered(initialEngine, initialStore);

    const layout = serializeWorkspaceLayout(source.scene, source.cursor);
    layout.cursor = { column: 2, row: 1, split: 0 };
    const restored = createWorkspaceScene({ initialLayout: layout });
    const restoredEngine = new WorkspaceLikeLayoutEngine(restored.scene);
    const restoredStore = new WorkspaceLayoutStore(
      restoredEngine,
      restored.scene,
      restored.cursor,
    );

    restoredStore.ensureFocusedPaneVisible(desktopViewport);
    expect(restoredStore.getSnapshot()).toMatchObject({
      cursor: { column: 2, row: 1, split: 0 },
      focusedPaneId: null,
    });
    expectCursorCellCentered(restoredEngine, restoredStore);
  });

  it("keeps overview fitted to occupied content plus the selected cursor", () => {
    const source = createWorkspaceScene({
      panes: [pane("origin", "origin", 0, 0)],
    });
    const engine = new WorkspaceLikeLayoutEngine(source.scene);

    const nearbyCursorBounds = engine.overviewContentBounds(
      desktopViewport,
      null,
      1,
      { column: 1, row: 0, split: 0 },
    );
    const distantCursorBounds = engine.overviewContentBounds(
      desktopViewport,
      null,
      1,
      { column: 1_000, row: 1_000, split: 0 },
    );

    expect(nearbyCursorBounds.contentWidth).toBeLessThan(
      distantCursorBounds.contentWidth,
    );
    expect(nearbyCursorBounds.contentHeight).toBeLessThan(
      distantCursorBounds.contentHeight,
    );
  });

  it("keeps every runtime-inserted bottom row focusable and visible", () => {
    const source = createWorkspaceScene({
      panes: [pane("origin", "origin", 0, 0)],
    });
    const engine = new WorkspaceLikeLayoutEngine(source.scene);
    const store = new WorkspaceLayoutStore(engine, source.scene, source.cursor);
    const paneIds = ["origin"];
    let paneId = "origin";

    for (let row = 1; row <= 10; row += 1) {
      paneId = store.splitPaneToPlane(paneId, "down");
      paneIds.push(paneId);
      expect(store.getSnapshot().cursor.row).toBe(row);
    }

    for (const [row, candidatePaneId] of paneIds.entries()) {
      expect(store.focusPane(candidatePaneId)).toBe(true);
      store.ensureFocusedPaneVisible(desktopViewport);
      store.snapAnimationsToTarget();
      expect(store.getSnapshot()).toMatchObject({
        cursor: { row },
        focusedPaneId: candidatePaneId,
      });
      expectCursorCellCentered(engine, store);
    }
  });

  it("recomputes cell and camera geometry after resize without changing the selected coordinate", () => {
    const { engine, scene } = geometryHarness();
    const store = new WorkspaceLayoutStore(
      engine,
      scene,
      { column: -1, row: 1, split: 0 },
      { initialFocusAnchor: "center" },
    );
    const compactViewport = { height: 640, width: 800, x: 0, y: 0 };

    store.ensureFocusedPaneVisible(desktopViewport);
    store.ensureFocusedPaneVisible(compactViewport);
    store.snapAnimationsToTarget();

    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: -1, row: 1, split: 0 },
      focusedPaneId: null,
    });
    expect(
      engine.gridCellBox(store.getSnapshot().cursor, compactViewport),
    ).toMatchObject({
      height: 620,
      kind: "empty",
      structural: false,
    });
    expectCursorCellCentered(engine, store, compactViewport);
  });
});

function geometryHarness() {
  const source = createWorkspaceScene({
    panes: [
      pane("origin", "top", 0, 0),
      pane("origin", "bottom", 0, 0),
      pane("far", "far", 0, 2),
    ],
  });
  const layout = serializeWorkspaceLayout(source.scene, source.cursor);
  layout.columns.push({
    cells: [{ paneId: null, reserved: true, weight: 1 }],
    columnId: "reserved",
    idealWidthSpec: { unit: "px", value: 280 },
    index: layout.columns.length,
    planeIndex: 0,
    slotIndex: 3,
    widthSpec: { unit: "px", value: 280 },
  });
  const restored = createWorkspaceScene({ initialLayout: layout });
  return {
    engine: new WorkspaceLikeLayoutEngine(restored.scene),
    scene: restored.scene,
  };
}

function pane(
  columnId: string,
  paneId: string,
  planeIndex: number,
  slotIndex: number,
) {
  return {
    columnId,
    columnWidth: { unit: "px" as const, value: 320 },
    paneId,
    planeIndex,
    slotIndex,
    surfaceKind: "test",
    title: paneId,
  };
}

function expectCursorCellCentered(
  engine: WorkspaceLikeLayoutEngine,
  store: WorkspaceLayoutStore,
  viewport = desktopViewport,
): void {
  const snapshot = store.getSnapshot();
  const box = engine.gridCellBox(
    snapshot.cursor,
    viewport,
    snapshot.maximizedPaneId,
  );
  const displayed = engine.gridCursorRenderItem({
    cursor: snapshot.cursor,
    focusedPaneId: snapshot.focusedPaneId,
    horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
    maximizedPaneId: snapshot.maximizedPaneId,
    movementPhase: "idle",
    presentationMode: "normal",
    scrollColumn: snapshot.scrollColumn,
    scrollRow: snapshot.scrollRow,
    verticalAnchorOffset: snapshot.verticalAnchorOffset,
    viewport,
  });

  expect(snapshot.scrollColumn).toBe(snapshot.targetScrollColumn);
  expect(snapshot.scrollColumn).toBe(snapshot.cursor.column);
  expect(snapshot.scrollRow).toBe(snapshot.targetScrollRow);
  expect(snapshot.scrollRow).toBe(snapshot.cursor.row);
  expect(displayed.x).toBeCloseTo(viewport.width / 2 - box.width / 2, 6);
  expect(displayed.y).toBeCloseTo(viewport.height / 2 - box.height / 2, 6);
}
