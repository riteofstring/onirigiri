import { describe, expect, it } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import { defaultWorkspaceGridAxes } from "../src/types";
import {
  workspaceCursorMoveIsWithinRunway,
  workspaceGridCursorAnnouncement,
  workspaceGridCursorForPane,
} from "../src/workspace/workspace-grid-cursor";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
} from "../src/workspace/workspace-scene";

describe("workspace grid cursor", () => {
  it("uses spatial navigation by default and validates explicit topology", () => {
    expect(defaultWorkspaceGridAxes).toBe("spatial");
    expect(createWorkspaceScene().scene.gridAxes).toBe("spatial");
    expect(
      createWorkspaceScene({ gridAxes: "horizontal" }).scene.gridAxes,
    ).toBe("horizontal");
    expect(() =>
      createWorkspaceScene({ gridAxes: "diagonal" as "spatial" }),
    ).toThrow("Onirigiri gridAxes must be horizontal or spatial");
  });

  it("selects exact empty and split cells without retaining a hidden pane focus", () => {
    const source = createWorkspaceScene({
      panes: [
        {
          columnId: "origin",
          paneId: "top",
          planeIndex: 0,
          slotIndex: 0,
          surfaceKind: "test",
          title: "Top",
        },
        {
          columnId: "origin",
          paneId: "bottom",
          planeIndex: 0,
          slotIndex: 0,
          surfaceKind: "test",
          title: "Bottom",
        },
        {
          columnId: "far",
          paneId: "far",
          planeIndex: 0,
          slotIndex: 2,
          surfaceKind: "test",
          title: "Far",
        },
      ],
    });
    const engine = new WorkspaceLikeLayoutEngine(source.scene);
    const store = new WorkspaceLayoutStore(engine, source.scene, source.cursor);

    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 0, row: 0, split: 0 },
      focusedPaneId: "top",
    });
    expect(store.moveFocus("down")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 0, row: 0, split: 1 },
      focusedPaneId: "bottom",
    });
    expect(store.moveFocus("down")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 0, row: 1, split: 0 },
      focusedPaneId: null,
    });
    expect(store.moveFocusedPane("right")).toBe(false);
    expect(store.createFocusedReservedBlankSplit("down")).toBe(false);

    expect(store.focusPane("top")).toBe(true);
    expect(store.moveFocus("right")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 1, row: 0, split: 0 },
      focusedPaneId: null,
    });
    expect(
      workspaceGridCursorAnnouncement(store.getSnapshot().cursor, null),
    ).toBe("Grid cell (1, 0), split 1: Empty cell.");
    expect(store.moveFocus("right")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 2, row: 0, split: 0 },
      focusedPaneId: "far",
    });
  });

  it("persists and restores a distant empty selected cell in schema 4", () => {
    const source = createWorkspaceScene({
      panes: [
        {
          columnId: "origin",
          paneId: "origin",
          planeIndex: 0,
          slotIndex: 0,
          surfaceKind: "test",
          title: "Origin",
        },
      ],
    });
    const engine = new WorkspaceLikeLayoutEngine(source.scene);
    const store = new WorkspaceLayoutStore(engine, source.scene, source.cursor);
    for (let step = 0; step < 24; step += 1) {
      expect(store.moveFocus("right")).toBe(true);
    }
    for (let step = 0; step < 9; step += 1) {
      expect(store.moveFocus("down")).toBe(true);
    }

    const layout = serializeWorkspaceLayout(
      store.toScene(),
      store.getSnapshot().cursor,
    );
    expect(layout).toMatchObject({
      cursor: { column: 24, row: 9, split: 0 },
      schemaVersion: 4,
    });
    expect("focusedPaneId" in layout).toBe(false);

    const restored = createWorkspaceScene({ initialLayout: layout });
    const restoredStore = new WorkspaceLayoutStore(
      new WorkspaceLikeLayoutEngine(restored.scene),
      restored.scene,
      restored.cursor,
    );
    expect(restoredStore.getSnapshot()).toMatchObject({
      cursor: { column: 24, row: 9, split: 0 },
      focusedPaneId: null,
    });
  });

  it("limits cursor navigation to a dynamic pane-relative runway", () => {
    const source = createWorkspaceScene({
      panes: [
        {
          columnId: "home-column",
          paneId: "home",
          planeIndex: 0,
          slotIndex: 0,
          surfaceKind: "test",
          title: "Home",
        },
        {
          columnId: "edge-column",
          paneId: "edge",
          planeIndex: 2,
          slotIndex: 2,
          surfaceKind: "test",
          title: "Edge",
        },
      ],
    });
    const store = new WorkspaceLayoutStore(
      new WorkspaceLikeLayoutEngine(source.scene),
      source.scene,
      source.cursor,
      { cursorRunway: 1 },
    );

    expect(store.moveFocus("left")).toBe(true);
    expect(store.canMoveFocus("left")).toBe(false);
    expect(store.moveFocus("left")).toBe(false);
    expect(store.returnHome()).toBe(true);
    expect(store.focusPane("edge")).toBe(true);
    expect(store.moveFocus("right")).toBe(true);
    expect(store.canMoveFocus("right")).toBe(false);
    expect(store.moveFocus("right")).toBe(false);
    expect(store.canMoveFocus("left")).toBe(true);
    expect(store.focusPane("edge")).toBe(true);
    expect(store.moveFocusedPane("right")).toBe(true);
    expect(store.getSnapshot().cursor.column).toBe(3);
    expect(store.moveFocus("right")).toBe(true);
    expect(store.moveFocus("right")).toBe(false);
  });

  it("lets an outlying cursor move inward after the pane runway contracts", () => {
    const source = createWorkspaceScene({
      panes: [
        {
          columnId: "home-column",
          paneId: "home",
          slotIndex: 0,
          surfaceKind: "test",
          title: "Home",
        },
        {
          columnId: "edge-column",
          paneId: "edge",
          slotIndex: 3,
          surfaceKind: "test",
          title: "Edge",
        },
      ],
    });
    const store = new WorkspaceLayoutStore(
      new WorkspaceLikeLayoutEngine(source.scene),
      source.scene,
      source.cursor,
      { cursorRunway: 0 },
    );

    expect(store.focusPane("edge")).toBe(true);
    expect(store.closePane("edge")).toBe("edge");
    expect(store.getSnapshot().cursor.column).toBe(3);
    expect(store.moveFocus("right")).toBe(false);
    expect(store.moveFocus("left")).toBe(true);
    expect(store.moveFocus("left")).toBe(true);
    expect(store.moveFocus("left")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 0, row: 0, split: 0 },
      focusedPaneId: "home",
    });
  });

  it("keeps split traversal available while an outlying cursor recovers", () => {
    expect(
      workspaceCursorMoveIsWithinRunway({
        bounds: { maxColumn: 0, maxRow: 0, minColumn: 0, minRow: 0 },
        current: { column: 0, row: 3, split: 1 },
        next: { column: 0, row: 3, split: 0 },
        runway: 0,
      }),
    ).toBe(true);
  });

  it("returns to the initial home pane by identity and falls back when it closes", () => {
    const source = createWorkspaceScene({
      panes: [
        {
          columnId: "home-column",
          paneId: "home",
          slotIndex: 0,
          surfaceKind: "test",
          title: "Home",
        },
        {
          columnId: "other-column",
          paneId: "other",
          slotIndex: 3,
          surfaceKind: "test",
          title: "Other",
        },
      ],
    });
    const store = new WorkspaceLayoutStore(
      new WorkspaceLikeLayoutEngine(source.scene),
      source.scene,
      source.cursor,
    );

    expect(store.moveFocusedPane("right")).toBe(true);
    expect(store.focusPane("other")).toBe(true);
    for (let step = 0; step < 8; step += 1) {
      expect(store.moveFocus("right")).toBe(true);
    }
    expect(store.returnHome()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 1, row: 0, split: 0 },
      focusedPaneId: "home",
    });
    store.toggleOverviewMode();
    expect(store.returnHome()).toBe(true);
    expect(store.getSnapshot().presentationMode).toBe("normal");
    expect(store.closePane("home")).toBe("home");
    expect(store.returnHome()).toBe(true);
    expect(store.getSnapshot().focusedPaneId).toBe("other");
  });

  it("validates cursor runway values without changing the unbounded default", () => {
    const source = createWorkspaceScene();
    for (const cursorRunway of [
      -1,
      0.5,
      Number.NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        () =>
          new WorkspaceLayoutStore(
            new WorkspaceLikeLayoutEngine(source.scene),
            source.scene,
            source.cursor,
            { cursorRunway },
          ),
      ).toThrow("Onirigiri cursorRunway must be a non-negative safe integer");
    }
    const store = new WorkspaceLayoutStore(
      new WorkspaceLikeLayoutEngine(source.scene),
      source.scene,
      source.cursor,
    );
    for (let step = 0; step < 20; step += 1) {
      expect(store.moveFocus("left")).toBe(true);
    }
    expect(store.getSnapshot().cursor.column).toBe(-20);
  });

  it("moves a focused pane beyond every former runway edge without pane loss", () => {
    const directions = [
      {
        direction: "left",
        endpoint: { column: -20, row: 0, split: 0 },
        returnDirection: "right",
      },
      {
        direction: "right",
        endpoint: { column: 20, row: 0, split: 0 },
        returnDirection: "left",
      },
      {
        direction: "up",
        endpoint: { column: 0, row: -20, split: 0 },
        returnDirection: "down",
      },
      {
        direction: "down",
        endpoint: { column: 0, row: 20, split: 0 },
        returnDirection: "up",
      },
    ] as const;

    for (const movement of directions) {
      const source = createWorkspaceScene({
        panes: [
          {
            columnId: "moving-column",
            columnWidth: { unit: "px", value: 340 },
            heightPx: 280,
            paneId: "moving",
            surfaceId: "moving-surface",
            surfaceKind: "test",
            title: "Moving",
            weight: 3,
          },
        ],
      });
      const engine = new WorkspaceLikeLayoutEngine(source.scene);
      const store = new WorkspaceLayoutStore(
        engine,
        source.scene,
        source.cursor,
      );

      for (let step = 0; step < 20; step += 1) {
        expect(store.moveFocusedPane(movement.direction)).toBe(true);
        expect(store.focusedPaneId()).toBe("moving");
      }

      expect(store.getSnapshot()).toMatchObject({
        cursor: movement.endpoint,
        focusedPaneId: "moving",
      });
      const distantScene = store.toScene();
      expect(workspaceGridCursorForPane(distantScene, "moving")).toEqual(
        movement.endpoint,
      );
      expect(distantScene.columns).toEqual([
        expect.objectContaining({
          cells: [
            {
              heightPx: 280,
              paneId: "moving",
              reserved: false,
              weight: 3,
            },
          ],
          planeIndex: movement.endpoint.row,
          slotIndex: movement.endpoint.column,
          widthSpec: { unit: "px", value: 340 },
        }),
      ]);
      expect(distantScene.paneById.get("moving")).toMatchObject({
        paneId: "moving",
        surfaceId: "moving-surface",
        title: "Moving",
      });

      const layout = serializeWorkspaceLayout(
        distantScene,
        store.getSnapshot().cursor,
      );
      const restored = createWorkspaceScene({ initialLayout: layout });
      expect(restored.cursor).toEqual(movement.endpoint);
      expect(workspaceGridCursorForPane(restored.scene, "moving")).toEqual(
        movement.endpoint,
      );

      expect(store.moveFocusedPane(movement.direction)).toBe(true);
      for (let step = 0; step < 21; step += 1) {
        expect(store.moveFocusedPane(movement.returnDirection)).toBe(true);
      }
      expect(store.getSnapshot()).toMatchObject({
        cursor: { column: 0, row: 0, split: 0 },
        focusedPaneId: "moving",
      });
      expect(store.toScene().columns).toHaveLength(1);
      expect(store.toScene().paneById.get("moving")?.surfaceId).toBe(
        "moving-surface",
      );
    }
  });

  it("keeps horizontal topology on one row while traversing local splits", () => {
    const source = createWorkspaceScene({
      gridAxes: "horizontal",
      panes: [
        {
          columnId: "origin",
          paneId: "top",
          surfaceKind: "test",
          title: "Top",
        },
        {
          columnId: "origin",
          paneId: "bottom",
          surfaceKind: "test",
          title: "Bottom",
        },
      ],
    });
    const store = new WorkspaceLayoutStore(
      new WorkspaceLikeLayoutEngine(source.scene),
      source.scene,
      source.cursor,
    );

    expect(store.moveFocus("down")).toBe(true);
    expect(store.getSnapshot().cursor).toEqual({
      column: 0,
      row: 0,
      split: 1,
    });
    expect(store.moveFocus("down")).toBe(false);
    expect(store.moveFocus("up")).toBe(true);
    expect(store.moveFocus("up")).toBe(false);
    expect(store.moveFocus("right")).toBe(true);
    expect(store.getSnapshot().cursor).toEqual({
      column: 1,
      row: 0,
      split: 0,
    });
  });

  it("swaps only the moved pane with an occupied adjacent cell", () => {
    const source = createWorkspaceScene({
      panes: [
        {
          columnId: "source-column",
          columnWidth: { unit: "px", value: 340 },
          heightPx: 280,
          paneId: "moving",
          surfaceId: "moving-surface",
          surfaceKind: "test",
          title: "Moving",
          weight: 3,
        },
        {
          columnId: "target-column",
          columnWidth: { unit: "px", value: 260 },
          heightPx: 180,
          paneId: "target",
          slotIndex: 1,
          surfaceId: "target-surface",
          surfaceKind: "test",
          title: "Target",
          weight: 2,
        },
      ],
    });
    const engine = new WorkspaceLikeLayoutEngine(source.scene);
    const store = new WorkspaceLayoutStore(engine, source.scene, source.cursor);

    expect(store.moveFocusedPane("right")).toBe(true);
    const scene = store.toScene();
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 1, row: 0, split: 0 },
      focusedPaneId: "moving",
    });
    expect(workspaceGridCursorForPane(scene, "moving")).toEqual({
      column: 1,
      row: 0,
      split: 0,
    });
    expect(workspaceGridCursorForPane(scene, "target")).toEqual({
      column: 0,
      row: 0,
      split: 0,
    });
    expect(scene.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cells: [
            {
              heightPx: 180,
              paneId: "moving",
              reserved: false,
              weight: 2,
            },
          ],
          slotIndex: 1,
        }),
        expect.objectContaining({
          cells: [
            {
              heightPx: 280,
              paneId: "target",
              reserved: false,
              weight: 3,
            },
          ],
          slotIndex: 0,
        }),
      ]),
    );
    expect(scene.paneById.get("moving")?.surfaceId).toBe("moving-surface");
    expect(scene.paneById.get("target")?.surfaceId).toBe("target-surface");
  });

  it("rejects malformed or inexact persisted coordinates", () => {
    const source = createWorkspaceScene();
    const layout = serializeWorkspaceLayout(source.scene, source.cursor);

    expect(() =>
      createWorkspaceScene({
        initialLayout: {
          ...layout,
          cursor: { ...layout.cursor, split: -1 },
        },
      }),
    ).toThrow("Onirigiri layout has an invalid workspace grid cursor");
    expect(() =>
      createWorkspaceScene({
        initialLayout: {
          ...layout,
          cursor: { ...layout.cursor, column: Number.MAX_SAFE_INTEGER + 1 },
        },
      }),
    ).toThrow("Onirigiri layout has an invalid workspace grid cursor");
    expect(() =>
      createWorkspaceScene({
        initialLayout: {
          ...layout,
          columns: layout.columns.map((column) => ({
            ...column,
            planeIndex: Number.MAX_SAFE_INTEGER + 1,
          })),
        },
      }),
    ).toThrow("Onirigiri layout has invalid column identities or cells");
  });

  it("stops safely only at the exact integer representation limit", () => {
    const source = createWorkspaceScene();
    const layout = serializeWorkspaceLayout(source.scene, source.cursor);
    const coordinate = Number.MAX_SAFE_INTEGER;
    const restored = createWorkspaceScene({
      initialLayout: {
        ...layout,
        columns: layout.columns.map((column) => ({
          ...column,
          slotIndex: coordinate,
        })),
        cursor: { column: coordinate, row: 0, split: 0 },
      },
    });
    const store = new WorkspaceLayoutStore(
      new WorkspaceLikeLayoutEngine(restored.scene),
      restored.scene,
      restored.cursor,
    );

    expect(store.canMoveFocus("right")).toBe(false);
    expect(store.moveFocus("right")).toBe(false);
    expect(store.canMoveFocus("left")).toBe(true);
    expect(store.moveFocus("left")).toBe(true);
    expect(store.getSnapshot().cursor.column).toBe(coordinate - 1);
  });
});
