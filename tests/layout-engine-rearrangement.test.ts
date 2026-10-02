import { describe, expect, it } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import { paneCellSizingForPane } from "../src/layout/pane-cell-sizing";
import type { WorkspaceColumn } from "../src/types";
import { workspaceGridCursorForPane } from "../src/workspace/workspace-grid-cursor";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
  type OnirigiriPaneDefinition,
} from "../src/workspace/workspace-scene";

describe("layout-engine rearrangement cells", () => {
  it("collapses transient vacancies but serializes a reserved blank exactly once", () => {
    const { engine } = storeFor(
      [paneDefinition("stack", "top", 0), paneDefinition("stack", "moving", 0)],
      "moving",
    );

    expect(engine.movePane("moving", "right")).toBe(true);
    expect(paneIds(columnForPane(engine, "top"))).toEqual(["top"]);
    expect(engine.createReservedBlankSplit("top", "down")).toBe(true);
    const sourceColumn = columnForPane(engine, "top");
    expect(sourceColumn.cells).toEqual([
      { paneId: "top", reserved: false, weight: 1 },
      { paneId: null, reserved: true, weight: 1 },
    ]);
    expect(
      engine.reservedCellRenderItems({
        focusedPaneId: "top",
        maximizedPaneId: null,
        movementPhase: "idle",
        presentationMode: "normal",
        renderAllColumns: true,
        scrollColumn: 0,
        scrollRow: 0,
        viewport: { height: 900, width: 1200, x: 0, y: 0 },
      }),
    ).toMatchObject([{ columnId: sourceColumn.columnId, rowIndex: 1 }]);
  });

  it("moves a selected structural group without changing its row or blank ownership", () => {
    const { engine, store } = storeFor(
      [paneDefinition("group", "top", 0), paneDefinition("group", "bottom", 0)],
      "top",
    );
    expect(store.createFocusedReservedBlankSplit("down")).toBe(true);
    expect(store.selectFocusedPaneGroup()).toBe(true);
    expect(store.moveSelectedPaneGroup("right")).toBe(true);

    const movedGroup = columnForPane(engine, "top");
    expect(movedGroup.cells).toEqual([
      { paneId: "top", reserved: false, weight: 1 },
      { paneId: null, reserved: true, weight: 1 },
      { paneId: "bottom", reserved: false, weight: 1 },
    ]);
    expect(engine.paneLocation("bottom")?.columnIndex).toBe(
      engine.paneLocation("top")?.columnIndex,
    );
    expect(store.getSnapshot()).toMatchObject({
      paneRearrangementSelection: "group",
      selectedGroupColumnId: movedGroup.columnId,
    });
  });

  it("creates the literal leading slot when a selected group moves left", () => {
    const { engine, store } = storeFor(
      [paneDefinition("group", "top", 0), paneDefinition("group", "bottom", 0)],
      "top",
    );
    expect(store.selectFocusedPaneGroup()).toBe(true);
    expect(store.moveSelectedPaneGroup("left")).toBe(true);

    const movedGroup = columnForPane(engine, "top");
    expect(movedGroup.slotIndex).toBe(0);
    expect(paneIds(movedGroup)).toEqual(["top", "bottom"]);
    expect(store.getSnapshot().selectedGroupColumnId).toBe(movedGroup.columnId);
  });

  it("inserts the focused pane into an occupied full-height column as a split", () => {
    const { engine, store } = storeFor(
      [
        paneDefinition("source", "moving", 0),
        paneDefinition("target", "target", 1),
      ],
      "moving",
    );

    expect(store.insertFocusedPaneAsSplit("right")).toBe(true);
    expect(paneIds(columnForPane(engine, "moving"))).toEqual([
      "target",
      "moving",
    ]);
    expect(paneCellSizingForPane(engine.toScene(), "moving")).toEqual({
      weight: 1,
    });
    expect(
      engine.toScene().columns.find((column) => column.columnId === "source"),
    ).toBeUndefined();
  });

  it("rejects schema 3 layouts without a migration path", () => {
    const source = createWorkspaceScene({
      panes: [paneDefinition("source", "moving", 0)],
    });
    const layout = serializeWorkspaceLayout(source.scene, source.cursor);
    layout.schemaVersion = 3;

    expect(() => createWorkspaceScene({ initialLayout: layout })).toThrow(
      "unsupported Onirigiri layout schema 3",
    );
  });
});

function storeFor(
  panes: readonly OnirigiriPaneDefinition[],
  focusedPaneId: string,
): { engine: WorkspaceLikeLayoutEngine; store: WorkspaceLayoutStore } {
  const result = createWorkspaceScene({ panes });
  const engine = new WorkspaceLikeLayoutEngine(result.scene);
  const cursor = workspaceGridCursorForPane(result.scene, focusedPaneId);
  if (!cursor) {
    throw new Error(`missing pane ${focusedPaneId}`);
  }
  return {
    engine,
    store: new WorkspaceLayoutStore(engine, result.scene, cursor),
  };
}

function paneDefinition(
  columnId: string,
  paneId: string,
  slotIndex: number,
): OnirigiriPaneDefinition {
  return {
    columnId,
    paneId,
    planeIndex: 0,
    slotIndex,
    surfaceKind: "test",
    title: paneId,
  };
}

function columnForPane(
  engine: WorkspaceLikeLayoutEngine,
  paneId: string,
): WorkspaceColumn {
  const column = engine
    .toScene()
    .columns.find((candidate) =>
      candidate.cells.some((cell) => cell.paneId === paneId),
    );
  if (!column) {
    throw new Error(`missing column for ${paneId}`);
  }
  return column;
}

function paneIds(column: WorkspaceColumn): Array<string | null> {
  return column.cells.map((cell) => cell.paneId);
}
