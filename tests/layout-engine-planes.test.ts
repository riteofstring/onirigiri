import { describe, expect, it } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import {
  denselyReindexPlanes,
  insertPlaneBeside,
} from "../src/layout/layout-planes";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import { paneCellSizingForPane } from "../src/layout/pane-cell-sizing";
import type { PaneRenderItem, WorkspaceColumn } from "../src/types";
import { workspaceGridCursorForPane } from "../src/workspace/workspace-grid-cursor";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
  type OnirigiriPaneDefinition,
} from "../src/workspace/workspace-scene";

describe("2D layout engine plane operations", () => {
  it("densely reindexes restored planes without changing slots", () => {
    const columns = [
      testColumn({ columnId: "upper", planeIndex: 2, slotIndex: 4 }),
      testColumn({ columnId: "lower", planeIndex: 8, slotIndex: 1 }),
    ];

    expect(planeAndSlotIndexes(denselyReindexPlanes(columns))).toEqual([
      [0, 4],
      [1, 1],
    ]);
    expect(planeAndSlotIndexes(columns)).toEqual([
      [2, 4],
      [8, 1],
    ]);
  });

  it("inserts a plane beside its source and shifts only occupied planes away from it", () => {
    const columns = [
      testColumn({ columnId: "far-above", planeIndex: -4, slotIndex: 0 }),
      testColumn({ columnId: "above", planeIndex: -2, slotIndex: 0 }),
      testColumn({ columnId: "source", planeIndex: -1, slotIndex: 0 }),
      testColumn({ columnId: "far-below", planeIndex: 3, slotIndex: 0 }),
    ];

    const below = insertPlaneBeside(columns, -1, 1);
    expect(below.planeIndex).toBe(0);
    expect(planeAndSlotIndexes(below.columns)).toEqual(
      planeAndSlotIndexes(columns),
    );

    const above = insertPlaneBeside(columns, -1, -1);
    expect(above.planeIndex).toBe(-2);
    expect(planeAndSlotIndexes(above.columns)).toEqual([
      [-5, 0],
      [-3, 0],
      [-1, 0],
      [3, 0],
    ]);
  });

  it("creates distinct planes above and below, then removes them cleanly", () => {
    const engine = engineFor([
      paneDefinition({
        columnId: "upper-column",
        paneId: "upper",
        planeIndex: 0,
        slotIndex: 2,
      }),
      paneDefinition({
        columnId: "source-column",
        paneId: "source",
        planeIndex: 1,
        slotIndex: 2,
      }),
      paneDefinition({
        columnId: "lower-column",
        paneId: "lower",
        planeIndex: 2,
        slotIndex: 2,
      }),
    ]);

    const createdAbovePaneId = engine.splitPaneToPlane("source", "up");
    const createdBelowPaneId = engine.splitPaneToPlane("source", "down");
    const splitScene = engine.toScene();
    expect(splitScene.columns.map((column) => column.planeIndex)).toEqual([
      -1, 0, 1, 2, 3,
    ]);
    expect(splitScene.columns.map((column) => column.slotIndex)).toEqual([
      2, 2, 2, 2, 2,
    ]);
    expect(engine.paneLocation("upper")?.planeIndex).toBe(-1);
    expect(engine.paneLocation(createdAbovePaneId)?.planeIndex).toBe(0);
    expect(engine.paneLocation("source")?.planeIndex).toBe(1);
    expect(engine.paneLocation(createdBelowPaneId)?.planeIndex).toBe(2);
    expect(engine.paneLocation("lower")?.planeIndex).toBe(3);

    engine.closePane(createdAbovePaneId);
    engine.closePane(createdBelowPaneId);
    expect(engine.toScene().columns.map((column) => column.planeIndex)).toEqual(
      [-1, 1, 3],
    );
    expect(engine.paneLocation("source")?.planeIndex).toBe(1);
    expect(engine.paneLocation("lower")?.planeIndex).toBe(3);
  });

  it("swaps the focused pane with the immediately adjacent occupied cell", () => {
    const engine = engineFor([
      paneDefinition({
        columnId: "left-column",
        heightPx: 240,
        paneId: "moving",
        planeIndex: 0,
        slotIndex: 0,
        weight: 3,
      }),
      paneDefinition({
        columnId: "right-column",
        heightPx: 180,
        paneId: "target",
        planeIndex: 0,
        slotIndex: 1,
        weight: 2,
      }),
    ]);

    expect(engine.movePane("moving", "right")).toBe(true);
    expect(engine.paneLocation("moving")).toMatchObject({
      planeIndex: 0,
      rowIndex: 0,
    });
    expect(columnForPane(engine, "moving").slotIndex).toBe(1);
    expect(columnForPane(engine, "target").slotIndex).toBe(0);
    expect(paneSizing(engine.toScene(), "moving")).toEqual({
      heightPx: 180,
      weight: 2,
    });
    expect(paneSizing(engine.toScene(), "target")).toEqual({
      heightPx: 240,
      weight: 3,
    });
  });

  it("uses the literal adjacent sparse slot instead of skipping a gap", () => {
    const engine = engineFor([
      paneDefinition({
        columnId: "source-column",
        heightPx: 240,
        paneId: "moving",
        planeIndex: 0,
        slotIndex: 0,
        weight: 3,
      }),
      paneDefinition({
        columnId: "far-column",
        paneId: "far",
        planeIndex: 0,
        slotIndex: 2,
      }),
    ]);

    expect(engine.movePane("moving", "right")).toBe(true);
    expect(columnForPane(engine, "moving").slotIndex).toBe(1);
    expect(columnForPane(engine, "far").slotIndex).toBe(2);
    expect(paneSizing(engine.toScene(), "moving")).toEqual({
      heightPx: 240,
      weight: 3,
    });
  });

  it("grows literal leading and terminal cells without losing the moved pane", () => {
    const { engine, store } = storeFor(
      [
        paneDefinition({
          columnId: "source-column",
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 0,
        }),
      ],
      "moving",
    );

    expect(store.moveFocusedPane("left")).toBe(true);
    expect(engine.paneLocation("moving")).toMatchObject({
      planeIndex: 0,
      rowIndex: 0,
    });
    expect(columnForPane(engine, "moving").slotIndex).toBe(-1);
    expect(store.moveFocusedPane("up")).toBe(true);
    expect(engine.paneLocation("moving")?.planeIndex).toBe(-1);

    for (let step = 0; step < 12; step += 1) {
      expect(store.moveFocusedPane("right")).toBe(true);
      expect(store.moveFocusedPane("down")).toBe(true);
    }
    const surfaceId = engine.toScene().paneById.get("moving")?.surfaceId;
    for (let step = 0; step < 12; step += 1) {
      expect(store.moveFocusedPane("left")).toBe(true);
      expect(store.moveFocusedPane("up")).toBe(true);
    }

    expect(store.focusedPaneId()).toBe("moving");
    expect(engine.toScene().paneById.get("moving")?.surfaceId).toBe(surfaceId);
  });

  it("moves a selected group one row below a pane moved to a sparse row", () => {
    const { engine, store } = storeFor(
      [
        paneDefinition({
          columnId: "anchor-column",
          paneId: "anchor",
          planeIndex: 0,
          slotIndex: 1,
        }),
        paneDefinition({
          columnId: "moving-column",
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 0,
        }),
      ],
      "moving",
    );
    for (let step = 0; step < 3; step += 1) {
      expect(store.moveFocusedPane("down")).toBe(true);
    }
    expect(engine.paneLocation("moving")?.planeIndex).toBe(3);

    expect(store.selectFocusedPaneGroup()).toBe(true);
    expect(store.moveSelectedPaneGroup("down")).toBe(true);
    expect(engine.paneLocation("moving")?.planeIndex).toBe(4);
    expect(engine.paneLocation("anchor")?.planeIndex).toBe(0);
  });

  it("moves a selected group one column left of a negative column", () => {
    const { engine, store } = storeFor(
      [
        paneDefinition({
          columnId: "moving-column",
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "anchor-column",
          paneId: "anchor",
          planeIndex: 0,
          slotIndex: 1,
        }),
      ],
      "moving",
    );
    expect(store.moveFocusedPane("left")).toBe(true);
    expect(columnForPane(engine, "moving").slotIndex).toBe(-1);

    expect(store.selectFocusedPaneGroup()).toBe(true);
    expect(store.moveSelectedPaneGroup("left")).toBe(true);
    expect(columnForPane(engine, "moving").slotIndex).toBe(-2);
    expect(columnForPane(engine, "anchor").slotIndex).toBe(1);
  });

  it("splits a pane on a negative row beside it", () => {
    const { engine, store } = storeFor(
      [
        paneDefinition({
          columnId: "moving-column",
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "anchor-column",
          paneId: "anchor",
          planeIndex: 0,
          slotIndex: 1,
        }),
      ],
      "moving",
    );
    expect(store.moveFocusedPane("up")).toBe(true);
    expect(engine.paneLocation("moving")?.planeIndex).toBe(-1);

    const createdPaneId = store.splitPane("moving", "right");
    expect(engine.paneLocation(createdPaneId)?.planeIndex).toBe(-1);
    expect(columnForPane(engine, createdPaneId).slotIndex).toBe(1);
    expect(columnForPane(engine, "moving").slotIndex).toBe(0);
    expect(engine.paneLocation("anchor")?.planeIndex).toBe(0);
  });

  it("uses one normal-mode target when selecting an overview pane", () => {
    const { store } = storeFor(
      [
        paneDefinition({
          columnId: "first-column",
          paneId: "first",
          planeIndex: 0,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "target-column",
          paneId: "target",
          planeIndex: 2,
          slotIndex: 4,
        }),
      ],
      "first",
    );
    const viewport = { height: 900, width: 1200, x: 0, y: 0 };

    expect(store.selectFocusedPaneGroup()).toBe(true);
    store.toggleOverviewMode();
    store.snapAnimationsToTarget();
    const overviewBeforeExit = store.getSnapshot();
    expect(store.focusOverviewPane("target", viewport)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      focusedPaneId: "target",
      overviewProgress: 1,
      paneRearrangementSelection: "pane",
      presentationMode: "normal",
      selectedGroupColumnId: null,
    });
    const directExit = store.getSnapshot();
    expect(directExit.overviewFollowOffsetX).toBe(
      overviewBeforeExit.overviewFollowOffsetX,
    );
    expect(directExit.overviewFollowOffsetY).toBe(
      overviewBeforeExit.overviewFollowOffsetY,
    );
    expect(directExit.scrollColumn).toBe(directExit.targetScrollColumn);
    expect(directExit.horizontalAnchorOffset).toBe(
      directExit.targetHorizontalAnchorOffset,
    );
    expect(directExit.scrollRow).toBe(directExit.targetScrollRow);

    while (store.advanceFrame(1000 / 60) === "moving") {}
    expect(store.getSnapshot()).toMatchObject({
      overviewPanX: 0,
      overviewPanY: 0,
      overviewProgress: 0,
      overviewZoom: 1,
      presentationMode: "normal",
    });
  });

  it("moves only the focused pane when its source column has siblings", () => {
    const engine = engineFor([
      paneDefinition({
        columnId: "source-column",
        paneId: "moving",
        planeIndex: 0,
        slotIndex: 0,
      }),
      paneDefinition({
        columnId: "source-column",
        paneId: "sibling",
        planeIndex: 0,
        slotIndex: 0,
      }),
    ]);

    expect(engine.movePane("moving", "right")).toBe(true);
    expect(columnForPane(engine, "moving").slotIndex).toBe(1);
    expect(columnForPane(engine, "sibling")).toMatchObject({
      columnId: "source-column",
      slotIndex: 0,
    });
    expect(paneIds(columnForPane(engine, "sibling"))).toEqual(["sibling"]);
  });

  it("round trips an empty horizontal source cell without losing pane identity or camera state", () => {
    const { engine, store } = storeFor(
      [
        paneDefinition({
          columnId: "source-column",
          heightPx: 240,
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 1,
          weight: 3,
        }),
      ],
      "moving",
    );
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    const cameraBefore = store.getSnapshot();
    const sourceSurfaceId = engine.toScene().paneById.get("moving")?.surfaceId;

    expect(store.moveFocusedPane("right")).toBe(true);
    expect(engine.paneLocation("moving")).toMatchObject({ rowIndex: 0 });
    expect(columnForPane(engine, "moving").slotIndex).toBe(2);
    expect(
      engine
        .toScene()
        .columns.find((column) => column.columnId === "source-column"),
    ).toBeUndefined();
    expect(store.moveFocusedPane("left")).toBe(true);
    expect(columnForPane(engine, "moving")).toMatchObject({
      slotIndex: 1,
    });
    expect(engine.toScene().paneById.get("moving")).toMatchObject({
      paneId: "moving",
      surfaceId: sourceSurfaceId,
    });
    expect(paneSizing(engine.toScene(), "moving")).toEqual({
      heightPx: 240,
      weight: 3,
    });
    expect(store.focusedPaneId()).toBe("moving");
    expect(store.getSnapshot()).toMatchObject({
      horizontalAnchorOffset: cameraBefore.horizontalAnchorOffset,
      scrollColumn: cameraBefore.scrollColumn,
      scrollRow: cameraBefore.scrollRow,
      targetHorizontalAnchorOffset: cameraBefore.targetHorizontalAnchorOffset,
      targetScrollColumn: cameraBefore.targetScrollColumn,
      targetScrollRow: cameraBefore.targetScrollRow,
    });
    expect(notifications).toBe(2);
    unsubscribe();
  });

  it("swaps only the two vertically adjacent occupied rows", () => {
    const engine = engineFor([
      paneDefinition({
        columnId: "stack",
        heightPx: 240,
        paneId: "moving",
        planeIndex: 0,
        slotIndex: 0,
        weight: 3,
      }),
      paneDefinition({
        columnId: "stack",
        heightPx: 180,
        paneId: "sibling",
        planeIndex: 0,
        slotIndex: 0,
        weight: 2,
      }),
    ]);

    expect(engine.movePane("moving", "down")).toBe(true);
    expect(paneIds(columnForPane(engine, "moving"))).toEqual([
      "sibling",
      "moving",
    ]);
    expect(paneSizing(engine.toScene(), "moving")).toEqual({
      heightPx: 180,
      weight: 2,
    });
    expect(paneSizing(engine.toScene(), "sibling")).toEqual({
      heightPx: 240,
      weight: 3,
    });

    expect(engine.movePane("moving", "up")).toBe(true);
    expect(paneIds(columnForPane(engine, "moving"))).toEqual([
      "moving",
      "sibling",
    ]);
  });

  it("round trips an asymmetric vertical empty cell without growing either stack", () => {
    const source = createWorkspaceScene({
      panes: [
        paneDefinition({
          columnId: "target-stack",
          heightPx: 180,
          paneId: "target",
          planeIndex: 1,
          slotIndex: 3,
          weight: 2,
        }),
        paneDefinition({
          columnId: "source-stack",
          heightPx: 220,
          paneId: "top",
          planeIndex: 0,
          slotIndex: 3,
          weight: 3,
        }),
        paneDefinition({
          columnId: "source-stack",
          heightPx: 300,
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 3,
          weight: 4,
        }),
      ],
    });
    const layout = serializeWorkspaceLayout(
      source.scene,
      cursorForPane(source.scene, "moving"),
    );
    const targetStack = layout.columns.find(
      (column) => column.columnId === "target-stack",
    );
    if (!targetStack) {
      throw new Error("expected target stack");
    }
    targetStack.cells = cellsFor(
      [null, "target"],
      [
        { heightPx: 320, weight: 1 },
        { heightPx: 180, weight: 2 },
      ],
      [true, false],
    );
    const restored = createWorkspaceScene({ initialLayout: layout });
    const engine = new WorkspaceLikeLayoutEngine(restored.scene);
    const store = new WorkspaceLayoutStore(
      engine,
      restored.scene,
      cursorForPane(restored.scene, "moving"),
    );
    const cameraBefore = store.getSnapshot();
    const sourceSurfaceId = engine.toScene().paneById.get("moving")?.surfaceId;
    expect(store.moveFocusedPane("down")).toBe(true);
    expect(columnForPane(engine, "moving")).toMatchObject({
      columnId: "target-stack",
      planeIndex: 1,
      slotIndex: 3,
    });
    expect(paneIds(columnForPane(engine, "moving"))).toEqual([
      "moving",
      "target",
    ]);
    expect(paneSizing(engine.toScene(), "moving")).toEqual({
      heightPx: 320,
      weight: 1,
    });
    expect(paneIds(columnForPane(engine, "top"))).toEqual(["top"]);

    expect(store.moveFocusedPane("up")).toBe(true);
    expect(columnForPane(engine, "moving")).toMatchObject({
      columnId: "source-stack",
      planeIndex: 0,
      slotIndex: 3,
    });
    expect(paneIds(columnForPane(engine, "moving"))).toEqual(["moving"]);
    expect(engine.toScene().paneById.get("moving")).toMatchObject({
      surfaceId: sourceSurfaceId,
    });
    expect(paneSizing(engine.toScene(), "moving")).toEqual({ weight: 1 });
    expect(store.focusedPaneId()).toBe("moving");
    expect(store.getSnapshot()).toMatchObject({
      horizontalAnchorOffset: cameraBefore.horizontalAnchorOffset,
      scrollColumn: cameraBefore.scrollColumn,
      scrollRow: cameraBefore.scrollRow,
      targetHorizontalAnchorOffset: cameraBefore.targetHorizontalAnchorOffset,
      targetScrollColumn: cameraBefore.targetScrollColumn,
      targetScrollRow: cameraBefore.targetScrollRow,
    });
    expect(engine.paneLocation("target")?.planeIndex).toBe(1);
  });

  it("retains only one structural owner for a repeated restored pane", () => {
    const source = createWorkspaceScene({
      panes: [
        paneDefinition({
          columnId: "source-column",
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 0,
        }),
      ],
    });
    const layout = serializeWorkspaceLayout(source.scene, source.cursor);
    const sourceColumn = layout.columns[0];
    if (!sourceColumn) {
      throw new Error("expected a source column");
    }
    const sourceCell = sourceColumn.cells[0];
    if (!sourceCell) {
      throw new Error("expected source cell sizing");
    }
    sourceColumn.cells = [{ ...sourceCell }, { ...sourceCell }];

    expect(() => createWorkspaceScene({ initialLayout: layout })).toThrow(
      'Onirigiri layout places pane "moving" twice in column source-column; a pane can appear only once.',
    );
  });

  it("moves the cursor to an exact sparse cell and preserves pane move sizing", () => {
    const { engine, store } = storeFor(
      [
        paneDefinition({
          columnId: "upper-left",
          paneId: "upper-left",
          planeIndex: 0,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "upper-near",
          paneId: "upper-near",
          planeIndex: 0,
          slotIndex: 2,
        }),
        paneDefinition({
          columnId: "lower-left",
          paneId: "lower-left",
          planeIndex: 1,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "moving-column",
          columnWidth: 360,
          heightPx: 220,
          paneId: "moving",
          planeIndex: 1,
          slotIndex: 3,
          weight: 4,
        }),
      ],
      "moving",
    );
    const viewport = { height: 900, width: 1200, x: 0, y: 0 };

    expect(store.moveFocusFromPane("lower-left", "up", viewport)).toBe(true);
    expect(store.focusedPaneId()).toBe("upper-left");
    expect(store.moveFocusFromPane("moving", "up", viewport)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 3, row: 0, split: 0 },
      focusedPaneId: null,
    });

    expect(store.focusPane("moving")).toBe(true);
    const layoutRevision = store.getSnapshot().layoutRevision;
    expect(store.moveFocusedPane("up")).toBe(true);
    expect(store.focusedPaneId()).toBe("moving");
    expect(store.getSnapshot().layoutRevision).toBe(layoutRevision + 1);
    expect(columnForPane(engine, "moving")).toMatchObject({
      planeIndex: 0,
      slotIndex: 3,
    });
    expect(paneSizing(engine.toScene(), "moving")).toEqual({
      heightPx: 220,
      weight: 4,
    });
    expect(engine.paneLocation("lower-left")?.planeIndex).toBe(1);
  });

  it("moves the cursor through structural and virtual sparse cells without changing the scene", () => {
    const source = createWorkspaceScene({
      panes: [
        paneDefinition({
          columnId: "source-column",
          paneId: "source",
          planeIndex: 0,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "far-column",
          paneId: "far",
          planeIndex: 0,
          slotIndex: 2,
        }),
      ],
    });
    const layout = serializeWorkspaceLayout(
      source.scene,
      cursorForPane(source.scene, "source"),
    );
    layout.columns.push({
      cells: cellsFor([null], [{ heightPx: 240, weight: 1 }], [true]),
      columnId: "empty-slot-1",
      idealWidthSpec: { unit: "px", value: 320 },
      index: layout.columns.length,
      planeIndex: 0,
      slotIndex: 1,
      widthSpec: { unit: "px", value: 320 },
    });
    const restored = createWorkspaceScene({ initialLayout: layout });
    const engine = new WorkspaceLikeLayoutEngine(restored.scene);
    const store = new WorkspaceLayoutStore(
      engine,
      restored.scene,
      restored.cursor,
    );
    const viewport = { height: 900, width: 1200, x: 0, y: 0 };
    const sceneBeforeFocus = engine.toScene();
    const layoutRevision = store.getSnapshot().layoutRevision;

    expect(store.moveFocus("right", viewport)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 1, row: 0, split: 0 },
      focusedPaneId: null,
    });
    expect(store.moveFocus("right", viewport)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 2, row: 0, split: 0 },
      focusedPaneId: "far",
    });
    expect(store.moveFocus("right", viewport)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 3, row: 0, split: 0 },
      focusedPaneId: null,
    });
    expect(store.moveFocus("right", viewport)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 4, row: 0, split: 0 },
      focusedPaneId: null,
    });
    expect(store.moveFocus("left", viewport)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 3, row: 0, split: 0 },
      focusedPaneId: null,
    });
    expect(store.getSnapshot().layoutRevision).toBe(layoutRevision);
    expect(engine.toScene()).toEqual(sceneBeforeFocus);
  });

  it("creates an aligned column for a sparse slot and synchronizes slot resizing", () => {
    const { engine, store } = storeFor(
      [
        paneDefinition({
          columnId: "upper-zero",
          columnWidth: 180,
          paneId: "upper",
          planeIndex: 0,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "lower-zero",
          columnWidth: 260,
          paneId: "lower",
          planeIndex: 1,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "source-column",
          columnWidth: 360,
          paneId: "moving",
          planeIndex: 1,
          slotIndex: 3,
          heightPx: 200,
          weight: 2,
        }),
      ],
      "moving",
    );

    engine.movePane("moving", "up");
    const movedColumn = columnForPane(engine, "moving");
    expect(movedColumn.planeIndex).toBe(0);
    expect(movedColumn.slotIndex).toBe(3);
    expect(movedColumn.widthSpec).toEqual({ unit: "px", value: 360 });
    expect(paneSizing(engine.toScene(), "moving")).toEqual({
      heightPx: 200,
      weight: 2,
    });

    store.resizeColumn("upper-zero", { unit: "px", value: 444 });
    const slotZeroColumns = engine
      .toScene()
      .columns.filter((column) => column.slotIndex === 0);
    expect(slotZeroColumns.map((column) => column.widthSpec)).toEqual([
      { unit: "px", value: 444 },
      { unit: "px", value: 444 },
    ]);
  });

  it("batches heterogeneous pane targets and uses the widest target in each aligned slot", () => {
    const { store } = storeFor(
      [
        paneDefinition({
          columnId: "upper-zero",
          paneId: "upper",
          planeIndex: 0,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "lower-zero",
          paneId: "lower-top",
          planeIndex: 1,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "lower-zero",
          paneId: "lower-bottom",
          planeIndex: 1,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "lower-two",
          paneId: "right",
          planeIndex: 1,
          slotIndex: 2,
        }),
      ],
      "upper",
    );
    let updates = 0;
    const unsubscribe = store.subscribe(() => {
      updates += 1;
    });

    store.resizePanes(
      [
        { heightPx: 150, paneId: "upper", widthPx: 260 },
        { heightPx: 210, paneId: "lower-top", widthPx: 380 },
        { heightPx: 170, paneId: "lower-bottom", widthPx: 310 },
        { heightPx: 240, paneId: "right", widthPx: 220 },
      ],
      { height: 900, width: 1200, x: 0, y: 0 },
    );
    unsubscribe();

    const scene = store.toScene();
    expect(
      scene.columns
        .filter((column) => column.slotIndex === 0)
        .map((column) => column.widthSpec),
    ).toEqual([
      { unit: "px", value: 380 },
      { unit: "px", value: 380 },
    ]);
    expect(
      scene.columns.find((column) => column.slotIndex === 2)?.widthSpec,
    ).toEqual({
      unit: "px",
      value: 220,
    });
    expect(scene.columns.flatMap((column) => rowSizing(column))).toEqual([
      { heightPx: 150, weight: 1 },
      { heightPx: 210, weight: 1 },
      { heightPx: 170, weight: 1 },
      { heightPx: 240, weight: 1 },
    ]);
    expect(updates).toBe(1);
  });

  it("centers the focused column and logical cell, then reanchors after the row is resized", () => {
    const { engine, store } = storeFor(
      [
        paneDefinition({
          columnId: "upper-column",
          columnWidth: 260,
          heightPx: 180,
          paneId: "upper",
          planeIndex: 0,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "lower-column",
          columnWidth: 340,
          heightPx: 120,
          paneId: "lower-top",
          planeIndex: 1,
          slotIndex: 2,
        }),
        paneDefinition({
          columnId: "lower-column",
          columnWidth: 340,
          heightPx: 100,
          paneId: "lower-bottom",
          planeIndex: 1,
          slotIndex: 2,
        }),
      ],
      "lower-bottom",
    );
    const viewport = { height: 800, width: 1200, x: 0, y: 0 };

    store.ensureFocusedPaneVisible(viewport);
    expect(store.getSnapshot()).toMatchObject({
      focusAnchor: "center",
    });
    store.snapAnimationsToTarget();
    expectCenteredCursorCell(engine, store, viewport, "lower-bottom");

    store.resizePaneRow("lower-bottom", 360);
    store.reanchorFocusedPane(viewport);
    store.snapAnimationsToTarget();
    expectCenteredCursorCell(engine, store, viewport, "lower-bottom");

    store.setFocusAnchor("start", viewport);
    store.snapAnimationsToTarget();
    const startAlignedPane = renderFocusedPane(engine, store, viewport);
    expect(startAlignedPane.x).toBe(engine.toScene().padding);
  });

  it("round trips mutated multi-plane layouts without losing sparse slots or focus", () => {
    const { store } = storeFor(
      [
        paneDefinition({
          columnId: "row-column",
          columnWidth: 220,
          heightPx: 180,
          paneId: "row-top",
          planeIndex: 0,
          slotIndex: 0,
          weight: 2,
        }),
        paneDefinition({
          columnId: "row-column",
          columnWidth: 220,
          heightPx: 260,
          paneId: "row-bottom",
          planeIndex: 0,
          slotIndex: 0,
          weight: 3,
        }),
        paneDefinition({
          columnId: "lower-zero",
          paneId: "lower",
          planeIndex: 1,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "source-column",
          columnWidth: 360,
          heightPx: 240,
          paneId: "source",
          planeIndex: 1,
          slotIndex: 3,
          weight: 4,
        }),
      ],
      "source",
    );

    const abovePaneId = store.openPaneNear("source", "above", {
      data: { restored: true },
      surfaceKind: "test",
      title: "Above source",
      widthSpec: { unit: "px", value: 360 },
    });
    const belowPaneId = store.splitPaneToPlane("source", "down");
    store.resizeColumn(
      columnForPaneInScene(store.toScene(), "source").columnId,
      {
        unit: "px",
        value: 444,
      },
    );
    expect(store.focusPane(abovePaneId)).toBe(true);

    const layout = serializeWorkspaceLayout(
      store.toScene(),
      store.getSnapshot().cursor,
    );
    expect(layout.schemaVersion).toBe(4);
    expect(layout.cursor).toEqual(store.getSnapshot().cursor);
    expect(
      layout.columns.map((column) => [column.planeIndex, column.slotIndex]),
    ).toEqual([
      [-1, 0],
      [0, 3],
      [1, 0],
      [1, 3],
      [2, 3],
    ]);
    expect(
      layout.columns
        .filter((column) => column.slotIndex === 3)
        .map((column) => column.widthSpec),
    ).toEqual([
      { unit: "px", value: 444 },
      { unit: "px", value: 444 },
      { unit: "px", value: 444 },
    ]);
    expect(
      layout.panes.find((pane) => pane.paneId === belowPaneId)?.surfaceKind,
    ).toBe("empty-frame");

    const restored = createWorkspaceScene({ initialLayout: layout });
    const restoredEngine = new WorkspaceLikeLayoutEngine(restored.scene);
    const restoredStore = new WorkspaceLayoutStore(
      restoredEngine,
      restored.scene,
      restored.cursor,
    );
    expect(
      serializeWorkspaceLayout(
        restoredStore.toScene(),
        restoredStore.getSnapshot().cursor,
      ),
    ).toEqual(layout);
  });

  it("resizes every stack in a plane to one shared outer height", () => {
    const { engine, store } = storeFor([
      paneDefinition({
        columnId: "single-column",
        paneId: "single",
        planeIndex: 0,
        slotIndex: 0,
      }),
      paneDefinition({
        columnId: "split-column",
        paneId: "split-top",
        planeIndex: 0,
        slotIndex: 1,
        weight: 3,
      }),
      paneDefinition({
        columnId: "split-column",
        paneId: "split-bottom",
        planeIndex: 0,
        slotIndex: 1,
        weight: 1,
      }),
      paneDefinition({
        columnId: "lower-column",
        paneId: "lower-plane",
        planeIndex: 1,
        slotIndex: 0,
      }),
    ]);

    expect(store.resizePaneRow("single", 500)).toBe(true);
    let scene = engine.toScene();
    expect(paneHeight(scene, "single")).toBe(500);
    expect(paneHeight(scene, "split-top")).toBe(369);
    expect(paneHeight(scene, "split-bottom")).toBe(123);
    expect(paneHeight(scene, "lower-plane")).toBeUndefined();
    expect(bottomEdgeForPane(engine, "single")).toBe(
      bottomEdgeForPane(engine, "split-bottom"),
    );

    expect(store.resizePaneSplit("split-top", "split-bottom", 1, 3)).toBe(true);
    scene = engine.toScene();
    expect(paneHeight(scene, "split-top")).toBe(123);
    expect(paneHeight(scene, "split-bottom")).toBe(369);
    expect(bottomEdgeForPane(engine, "single")).toBe(
      bottomEdgeForPane(engine, "split-bottom"),
    );

    expect(store.resizePaneRow("split-bottom", 100)).toBe(true);
    scene = engine.toScene();
    expect(paneHeight(scene, "single")).toBe(200);
    expect(paneHeight(scene, "split-top")).toBe(96);
    expect(paneHeight(scene, "split-bottom")).toBe(96);
    expect(bottomEdgeForPane(engine, "single")).toBe(
      bottomEdgeForPane(engine, "split-bottom"),
    );

    expect(store.resizePaneRow("single", null)).toBe(true);
    scene = engine.toScene();
    expect(paneHeight(scene, "single")).toBeUndefined();
    expect(paneHeight(scene, "split-top")).toBeUndefined();
    expect(paneHeight(scene, "split-bottom")).toBeUndefined();
  });

  it("keeps resized structural-cell geometry while pane occupancy changes", () => {
    const horizontal = storeFor(
      [
        paneDefinition({
          columnId: "source-column",
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 0,
        }),
        paneDefinition({
          columnId: "target-column",
          paneId: "target",
          planeIndex: 0,
          slotIndex: 1,
        }),
        paneDefinition({
          columnId: "target-column",
          paneId: "target-sibling",
          planeIndex: 0,
          slotIndex: 1,
        }),
      ],
      "moving",
    );
    expect(horizontal.store.resizePaneRow("moving", 420)).toBe(true);
    const horizontalBefore = renderedPaneBoxes(horizontal.engine);
    const horizontalSizing = rowSizingSnapshot(horizontal.engine.toScene());

    expect(horizontal.store.moveFocusedPane("right")).toBe(true);
    expect(rowSizingSnapshot(horizontal.engine.toScene())).toEqual(
      horizontalSizing,
    );
    expect(paneIds(columnForPane(horizontal.engine, "moving"))).toEqual([
      "moving",
      "target-sibling",
    ]);
    expect(paneIds(columnForPane(horizontal.engine, "target"))).toEqual([
      "target",
    ]);
    expect(renderedPaneBoxes(horizontal.engine).get("moving")).toEqual(
      horizontalBefore.get("target"),
    );
    expect(renderedPaneBoxes(horizontal.engine).get("target")).toEqual(
      horizontalBefore.get("moving"),
    );

    const vertical = storeFor(
      [
        paneDefinition({
          columnId: "source-stack",
          heightPx: 220,
          paneId: "source-top",
          planeIndex: 0,
          slotIndex: 0,
          weight: 3,
        }),
        paneDefinition({
          columnId: "source-stack",
          heightPx: 420,
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 0,
          weight: 4,
        }),
        paneDefinition({
          columnId: "target-stack",
          heightPx: 180,
          paneId: "target-top",
          planeIndex: 1,
          slotIndex: 0,
          weight: 2,
        }),
        paneDefinition({
          columnId: "target-stack",
          heightPx: 300,
          paneId: "target",
          planeIndex: 1,
          slotIndex: 0,
          weight: 2,
        }),
      ],
      "moving",
    );
    const verticalBefore = renderedPaneBoxes(vertical.engine);
    const verticalSizing = rowSizingSnapshot(vertical.engine.toScene());

    expect(vertical.store.moveFocusedPane("down")).toBe(true);
    expect(rowSizingSnapshot(vertical.engine.toScene())).toEqual(
      verticalSizing,
    );
    expect(paneIds(columnForPane(vertical.engine, "moving"))).toEqual([
      "moving",
      "target",
    ]);
    expect(paneIds(columnForPane(vertical.engine, "target-top"))).toEqual([
      "source-top",
      "target-top",
    ]);
    expect(renderedPaneBoxes(vertical.engine).get("moving")).toEqual(
      verticalBefore.get("target-top"),
    );
    expect(renderedPaneBoxes(vertical.engine).get("target-top")).toEqual(
      verticalBefore.get("moving"),
    );
    expect(vertical.store.moveFocusedPane("up")).toBe(true);
    expect(paneIds(columnForPane(vertical.engine, "moving"))).toEqual([
      "moving",
      "target-top",
    ]);
    expect(paneIds(columnForPane(vertical.engine, "source-top"))).toEqual([
      "source-top",
      "target",
    ]);
    expect(rowSizingSnapshot(vertical.engine.toScene())).toEqual(
      verticalSizing,
    );

    const emptyLayoutSource = createWorkspaceScene({
      panes: [
        paneDefinition({
          columnId: "empty-stack",
          heightPx: 420,
          paneId: "moving",
          planeIndex: 0,
          slotIndex: 0,
          weight: 4,
        }),
        paneDefinition({
          columnId: "unaffected-column",
          heightPx: 300,
          paneId: "unaffected",
          planeIndex: 1,
          slotIndex: 1,
        }),
      ],
    });
    const emptyLayout = serializeWorkspaceLayout(
      emptyLayoutSource.scene,
      cursorForPane(emptyLayoutSource.scene, "moving"),
    );
    const emptyStack = emptyLayout.columns.find(
      (column) => column.columnId === "empty-stack",
    );
    if (!emptyStack) {
      throw new Error("expected empty stack");
    }
    emptyStack.cells = cellsFor(
      ["moving", null],
      [
        { heightPx: 420, weight: 4 },
        { heightPx: 300, weight: 2 },
      ],
    );
    const emptyRestored = createWorkspaceScene({ initialLayout: emptyLayout });
    const emptyEngine = new WorkspaceLikeLayoutEngine(emptyRestored.scene);
    const emptyDestination = {
      engine: emptyEngine,
      store: new WorkspaceLayoutStore(
        emptyEngine,
        emptyRestored.scene,
        cursorForPane(emptyRestored.scene, "moving"),
      ),
    };
    const emptyBefore = renderedPaneBoxes(emptyDestination.engine);
    expect(emptyDestination.store.moveFocusedPane("down")).toBe(true);
    const emptyScene = emptyDestination.engine.toScene();
    expect(paneIds(columnForPane(emptyDestination.engine, "moving"))).toEqual([
      "moving",
    ]);
    expect(paneSizing(emptyScene, "moving")).toEqual({ weight: 1 });
    const unaffectedAfter = renderedPaneBoxes(emptyDestination.engine).get(
      "unaffected",
    );
    expect(unaffectedAfter).toMatchObject({
      height: emptyBefore.get("unaffected")?.height,
      width: emptyBefore.get("unaffected")?.width,
      x: emptyBefore.get("unaffected")?.x,
    });
    expect(unaffectedAfter?.y).toBeGreaterThan(
      emptyBefore.get("unaffected")?.y ?? 0,
    );
    expect(
      renderedPaneBoxes(emptyDestination.engine).get("moving")?.height,
    ).toBeGreaterThan(300);
    expect(emptyDestination.store.moveFocusedPane("up")).toBe(true);
    expect(paneIds(columnForPane(emptyDestination.engine, "moving"))).toEqual([
      "moving",
    ]);
  });
});

function engineFor(
  panes: readonly OnirigiriPaneDefinition[],
): WorkspaceLikeLayoutEngine {
  return new WorkspaceLikeLayoutEngine(createWorkspaceScene({ panes }).scene);
}

function storeFor(
  panes: readonly OnirigiriPaneDefinition[],
  initialFocusedPaneId?: string,
): { engine: WorkspaceLikeLayoutEngine; store: WorkspaceLayoutStore } {
  const result = createWorkspaceScene({ panes });
  const engine = new WorkspaceLikeLayoutEngine(result.scene);
  return {
    engine,
    store: new WorkspaceLayoutStore(
      engine,
      result.scene,
      initialFocusedPaneId
        ? cursorForPane(result.scene, initialFocusedPaneId)
        : result.cursor,
    ),
  };
}

function paneDefinition({
  columnId,
  columnWidth = 320,
  heightPx,
  paneId,
  planeIndex,
  slotIndex,
  weight,
}: {
  columnId: string;
  columnWidth?: number;
  heightPx?: number;
  paneId: string;
  planeIndex: number;
  slotIndex: number;
  weight?: number;
}): OnirigiriPaneDefinition {
  return {
    columnId,
    columnWidth: { unit: "px", value: columnWidth },
    heightPx,
    paneId,
    planeIndex,
    slotIndex,
    surfaceKind: "test",
    title: paneId,
    weight,
  };
}

function testColumn({
  columnId,
  planeIndex,
  slotIndex,
}: {
  columnId: string;
  planeIndex: number;
  slotIndex: number;
}): WorkspaceColumn {
  return {
    cells: [{ paneId: `${columnId}-pane`, reserved: false, weight: 1 }],
    columnId,
    idealWidthSpec: { unit: "px", value: 320 },
    index: 0,
    planeIndex,
    slotIndex,
    widthSpec: { unit: "px", value: 320 },
  };
}

function planeAndSlotIndexes(
  columns: readonly WorkspaceColumn[],
): [number, number | undefined][] {
  return columns.map((column) => [column.planeIndex, column.slotIndex]);
}

function columnForPane(
  engine: WorkspaceLikeLayoutEngine,
  paneId: string,
): WorkspaceColumn {
  return columnForPaneInScene(engine.toScene(), paneId);
}

function cursorForPane(
  scene: Parameters<typeof workspaceGridCursorForPane>[0],
  paneId: string,
) {
  const cursor = workspaceGridCursorForPane(scene, paneId);
  if (!cursor) {
    throw new Error(`missing pane ${paneId}`);
  }
  return cursor;
}

function columnForPaneInScene(
  scene: { columns: readonly WorkspaceColumn[] },
  paneId: string,
): WorkspaceColumn {
  const column = scene.columns.find((candidate) =>
    candidate.cells.some((cell) => cell.paneId === paneId),
  );
  if (!column) {
    throw new Error(`missing column for ${paneId}`);
  }
  return column;
}

function renderedItems(engine: WorkspaceLikeLayoutEngine): PaneRenderItem[] {
  const items: PaneRenderItem[] = [];
  engine.renderFrame(
    {
      focusedPaneId: "moving",
      maximizedPaneId: null,
      movementPhase: "idle",
      presentationMode: "normal",
      renderAllColumns: true,
      scrollColumn: 0,
      scrollRow: 0,
      viewport: { height: 900, width: 1200, x: 0, y: 0 },
    },
    (item) => items.push(item),
  );
  return items.toSorted((left, right) =>
    left.paneId.localeCompare(right.paneId),
  );
}

function renderFocusedPane(
  engine: WorkspaceLikeLayoutEngine,
  store: WorkspaceLayoutStore,
  viewport: { height: number; width: number; x: number; y: number },
): PaneRenderItem {
  const snapshot = store.getSnapshot();
  const items = renderStoreItems(engine, store, viewport);
  const focusedPane = items.find(
    (item) => item.paneId === snapshot.focusedPaneId,
  );
  if (!focusedPane) {
    throw new Error(`missing focused pane ${snapshot.focusedPaneId}`);
  }
  return focusedPane;
}

function renderStoreItems(
  engine: WorkspaceLikeLayoutEngine,
  store: WorkspaceLayoutStore,
  viewport: { height: number; width: number; x: number; y: number },
): PaneRenderItem[] {
  const snapshot = store.getSnapshot();
  const items: PaneRenderItem[] = [];
  engine.renderFrame(
    {
      focusedPaneId: snapshot.focusedPaneId,
      horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
      maximizedPaneId: snapshot.maximizedPaneId,
      movementPhase: "idle",
      presentationMode: "normal",
      renderAllColumns: true,
      scrollColumn: snapshot.scrollColumn,
      scrollRow: snapshot.scrollRow,
      verticalAnchorOffset: snapshot.verticalAnchorOffset,
      viewport,
    },
    (item) => items.push(item),
  );
  return items;
}

function expectCenteredCursorCell(
  engine: WorkspaceLikeLayoutEngine,
  store: WorkspaceLayoutStore,
  viewport: { height: number; width: number; x: number; y: number },
  paneId: string,
): void {
  const focusedPane = renderFocusedPane(engine, store, viewport);
  expect(focusedPane.paneId).toBe(paneId);
  expect(focusedPane.x + focusedPane.width / 2).toBeCloseTo(
    viewport.width / 2,
    6,
  );
  expect(focusedPane.y + focusedPane.height / 2).toBeCloseTo(
    viewport.height / 2,
    6,
  );
}

function bottomEdgeForPane(
  engine: WorkspaceLikeLayoutEngine,
  paneId: string,
): number {
  const item = renderedItems(engine).find(
    (candidate) => candidate.paneId === paneId,
  );
  if (!item) {
    throw new Error(`missing render item for ${paneId}`);
  }
  return item.y + item.height * item.scale;
}

function paneHeight(
  scene: ReturnType<WorkspaceLikeLayoutEngine["toScene"]>,
  paneId: string,
) {
  return paneSizing(scene, paneId).heightPx;
}

function paneSizing(
  scene: ReturnType<WorkspaceLikeLayoutEngine["toScene"]>,
  paneId: string,
) {
  const sizing = paneCellSizingForPane(scene, paneId);
  if (!sizing) {
    throw new Error(`missing pane sizing ${paneId}`);
  }
  return sizing;
}

function rowSizingSnapshot(
  scene: ReturnType<WorkspaceLikeLayoutEngine["toScene"]>,
) {
  return scene.columns.map((column) => ({
    columnId: column.columnId,
    rowSizing: rowSizing(column),
  }));
}

function paneIds(column: WorkspaceColumn): Array<string | null> {
  return column.cells.map((cell) => cell.paneId);
}

function rowSizing(column: WorkspaceColumn) {
  return column.cells.map(({ heightPx, weight }) =>
    heightPx === undefined ? { weight } : { heightPx, weight },
  );
}

function cellsFor(
  paneIds: readonly (string | null)[],
  sizing: readonly { heightPx?: number; weight: number }[],
  reserved: readonly boolean[] = [],
) {
  return paneIds.map((paneId, index) => ({
    ...(sizing[index]?.heightPx === undefined
      ? {}
      : { heightPx: sizing[index]?.heightPx }),
    paneId,
    reserved: reserved[index] ?? false,
    weight: sizing[index]?.weight ?? 1,
  }));
}

function renderedPaneBoxes(engine: WorkspaceLikeLayoutEngine) {
  return new Map(
    renderedItems(engine).map((item) => [
      item.paneId,
      { height: item.height, width: item.width, x: item.x, y: item.y },
    ]),
  );
}
