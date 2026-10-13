import { describe, expect, it, vi } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
} from "../src/workspace/workspace-scene";

describe("workspace pane titles", () => {
  it.each([
    { presentation: "normal", selection: "pane" },
    { presentation: "normal", selection: "empty cell" },
    { presentation: "overview", selection: "pane" },
    { presentation: "overview", selection: "empty cell" },
  ] as const)(
    "renames another pane without moving the $selection in $presentation",
    ({ presentation, selection }) => {
      const result = createWorkspaceScene({
        gridAxes: "spatial",
        panes: [0, 1].map((index) => ({
          paneId: `pane-${index}`,
          slotIndex: index,
          surfaceKind: "test",
          title: `Pane ${index}`,
        })),
      });
      const engine = new WorkspaceLikeLayoutEngine(result.scene);
      const store = new WorkspaceLayoutStore(engine, result.scene, result.cursor);
      const viewport = { height: 800, width: 1280, x: 0, y: 0 };
      store.ensureFocusedPaneVisible(viewport);
      store.focusPane("pane-1");
      if (selection === "empty cell") {
        expect(store.moveFocus("down", viewport)).toBe(true);
      }
      if (presentation === "overview") store.toggleOverviewMode();
      store.snapAnimationsToTarget();
      const before = store.getSnapshot();
      expect(before.focusedPaneId).toBe(selection === "pane" ? "pane-1" : null);
      const selectedCell = () =>
        engine.gridCursorRenderItem({
          ...store.getSnapshot(),
          movementPhase: "idle",
          viewport,
        });
      const beforeCell = selectedCell();

      expect(store.renamePane("pane-0", "Updated title")).toBe(true);

      expect(store.toScene().paneById.get("pane-0")?.title).toBe("Updated title");
      expect(store.getSnapshot()).toMatchObject({
        cursor: before.cursor,
        focusedPaneId: before.focusedPaneId,
        presentationMode: presentation,
        scrollColumn: before.scrollColumn,
        scrollRow: before.scrollRow,
        targetScrollColumn: before.targetScrollColumn,
        targetScrollRow: before.targetScrollRow,
        horizontalAnchorOffset: before.horizontalAnchorOffset,
        verticalAnchorOffset: before.verticalAnchorOffset,
        targetHorizontalAnchorOffset: before.targetHorizontalAnchorOffset,
        targetVerticalAnchorOffset: before.targetVerticalAnchorOffset,
      });
      expect(selectedCell()).toEqual(beforeCell);
    },
  );
});

describe("workspace overview scale", () => {
  it("keeps current row defaults and explicit sizes through layout restoration", () => {
    const result = createWorkspaceScene({
      gridAxes: "spatial",
      panes: [0, 1, 2].map((index) => ({
        paneId: `pane-${index}`,
        planeIndex: index,
        slotIndex: 0,
        surfaceKind: index === 2 ? "notes" : "test",
        title: `Pane ${index}`,
      })),
    });
    const engine = new WorkspaceLikeLayoutEngine(result.scene);
    const store = new WorkspaceLayoutStore(engine, result.scene, result.cursor);
    const viewport = { height: 1000, width: 1280, x: 0, y: 0 };
    store.ensureFocusedPaneVisible(viewport);
    store.resizePaneRow("pane-0", 600);
    store.setPaneDefaults({
      paneDefaults: { height: 420 },
      paneTypeDefaults: { notes: { height: 380 } },
    });
    const expected = engine.paneWorldBoxes(viewport);
    expect(expected.map((pane) => pane.height)).toEqual([600, 420, 380]);
    const layout = serializeWorkspaceLayout(
      store.toScene(),
      store.getSnapshot().cursor,
    );
    store.restoreLayout(layout, { keepPresentation: true });
    expect(engine.paneWorldBoxes(viewport)).toEqual(expected);
  });

  it.each(["follow", "fixed"] as const)(
    "refreshes %s overview geometry when its width constraints change",
    (overview) => {
      const result = createWorkspaceScene({
        panes: Array.from({ length: 12 }, (_, index) => ({
          paneId: `pane-${index}`,
          columnWidth: { unit: "px" as const, value: 520 },
          surfaceKind: "test",
          title: `Pane ${index}`,
        })),
      });
      const engine = new WorkspaceLikeLayoutEngine(result.scene);
      const store = new WorkspaceLayoutStore(
        engine,
        result.scene,
        result.cursor,
        {
          initialCameraModes: { normal: "follow", compact: "follow", overview },
        },
      );
      const viewport = { height: 800, width: 1280, x: 0, y: 0 };
      store.ensureFocusedPaneVisible(viewport);
      store.focusPane("pane-6");
      store.snapAnimationsToTarget();
      store.setOverviewCardWidths(80, 80);
      store.toggleOverviewMode();
      store.snapAnimationsToTarget();
      const scale = () =>
        engine.gridCursorRenderItem({
          ...store.getSnapshot(),
          movementPhase: "idle",
          viewport,
        }).scale;
      const farScale = scale();
      expect(farScale).toBeCloseTo(80 / 520, 6);
      const cursor = store.getSnapshot().cursor;
      const layoutRevision = store.getSnapshot().layoutRevision;
      store.setOverviewCardWidths(240, 240);
      expect(scale()).toBeCloseTo(240 / 520, 6);
      expect(store.getSnapshot().cursor).toEqual(cursor);
      expect(store.getSnapshot().layoutRevision).toBe(layoutRevision);
      const changed = vi.fn();
      const unsubscribe = store.subscribe(changed);
      store.setOverviewCardWidths(240, 240);
      expect(changed).not.toHaveBeenCalled();
      unsubscribe();
      store.toggleOverviewMode();
      store.snapAnimationsToTarget();
      store.setOverviewCardWidths(80, 80);
      store.toggleOverviewMode();
      store.snapAnimationsToTarget();
      expect(scale()).toBeCloseTo(farScale, 6);
      store.setOverviewCardWidths(undefined, undefined);
      if (overview === "follow") expect(scale()).toBe(0.68);
    },
  );
  it("keeps a large following overview close at one stable scale", () => {
    const panes = Array.from({ length: 500 }, (_, index) => ({
      columnId: `overview-column-${String(index)}`,
      columnWidth: { unit: "px" as const, value: 384 },
      paneId: `overview-pane-${String(index)}`,
      slotIndex: index,
      surfaceKind: "test",
      title: `Overview pane ${String(index)}`,
    }));
    const result = createWorkspaceScene({ panes });
    const engine = new WorkspaceLikeLayoutEngine(result.scene);
    const store = new WorkspaceLayoutStore(engine, result.scene, result.cursor);
    const viewport = { height: 2_124, width: 3_840, x: 0, y: 0 };
    store.ensureFocusedPaneVisible(viewport);
    expect(store.focusPane("overview-pane-250")).toBe(true);
    store.snapAnimationsToTarget();
    store.toggleOverviewMode();
    store.snapAnimationsToTarget();
    const initialScale = store.getSnapshot().overviewFixedScale;

    expect(initialScale).toBeGreaterThanOrEqual(0.6);
    expect(store.focusPane("overview-pane-400")).toBe(true);
    expect(store.getSnapshot().overviewFixedScale).toBeCloseTo(
      initialScale ?? 0,
      6,
    );
  });

  it("keeps the point under the zoom focus in place while following the cursor", () => {
    const panes = Array.from({ length: 12 }, (_, index) => ({
      columnId: `zoom-column-${String(index)}`,
      columnWidth: { unit: "px" as const, value: 384 },
      paneId: `zoom-pane-${String(index)}`,
      planeIndex: Math.floor(index / 4),
      slotIndex: index % 4,
      surfaceKind: "test",
      title: `Zoom pane ${String(index)}`,
    }));
    const result = createWorkspaceScene({ panes });
    const engine = new WorkspaceLikeLayoutEngine(result.scene);
    const store = new WorkspaceLayoutStore(engine, result.scene, result.cursor);
    const viewport = { height: 800, width: 1_280, x: 0, y: 0 };
    store.ensureFocusedPaneVisible(viewport);
    expect(store.focusPane("zoom-pane-9")).toBe(true);
    store.snapAnimationsToTarget();
    expect(store.moveFocus("up", viewport)).toBe(true);
    store.snapAnimationsToTarget();
    store.toggleOverviewMode();
    store.snapAnimationsToTarget();
    const focusedCenter = () => {
      const snapshot = store.getSnapshot();
      const item = engine.gridCursorRenderItem({
        cursor: snapshot.cursor,
        focusedPaneId: snapshot.focusedPaneId,
        maximizedPaneId: null,
        movementPhase: "idle",
        overviewFixedScale: snapshot.overviewFixedScale,
        overviewFollowOffsetX: snapshot.overviewFollowOffsetX,
        overviewFollowOffsetY: snapshot.overviewFollowOffsetY,
        overviewPanX: snapshot.overviewPanX,
        overviewPanY: snapshot.overviewPanY,
        overviewZoom: snapshot.overviewZoom,
        presentationMode: "overview",
        scrollColumn: 0,
        scrollRow: 0,
        viewport,
      });
      return {
        x: item.x + (item.width * item.scale) / 2,
        y: item.y + (item.height * item.scale) / 2,
      };
    };
    const before = focusedCenter();
    expect(before.x).toBeCloseTo(640, 0);
    expect(before.y).toBeCloseTo(400, 0);

    expect(store.zoomOverviewBy(0.5, before.x, before.y, viewport)).toBe(true);
    const after = focusedCenter();
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it("keeps overview and maximization through a restore that keeps presentation", () => {
    const definitions = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        columnId: `restore-column-${String(index)}`,
        paneId: `restore-pane-${String(index)}`,
        slotIndex: index,
        surfaceKind: "test",
        title: `Restore pane ${String(index)}`,
      }));
    const result = createWorkspaceScene({ panes: definitions(4) });
    const engine = new WorkspaceLikeLayoutEngine(result.scene);
    const store = new WorkspaceLayoutStore(engine, result.scene, result.cursor);
    const viewport = { height: 800, width: 1_280, x: 0, y: 0 };
    store.ensureFocusedPaneVisible(viewport);
    expect(store.focusPane("restore-pane-2")).toBe(true);
    store.togglePaneMaximized("restore-pane-2");
    store.toggleOverviewMode();
    store.snapAnimationsToTarget();

    const grown = createWorkspaceScene({ panes: definitions(6) });
    store.restoreLayout(
      serializeWorkspaceLayout(grown.scene, { column: 2, row: 0, split: 0 }),
      { keepPresentation: true },
    );

    const kept = store.getSnapshot();
    expect(kept.presentationMode).toBe("overview");
    expect(kept.maximizedPaneId).toBe("restore-pane-2");
    expect(kept.focusedPaneId).toBe("restore-pane-2");
    expect(engine.paneLocation("restore-pane-5")).toBeTruthy();

    store.restoreLayout(
      serializeWorkspaceLayout(grown.scene, { column: 2, row: 0, split: 0 }),
    );
    expect(store.getSnapshot().presentationMode).toBe("normal");
    expect(store.getSnapshot().maximizedPaneId).toBeNull();
  });
});
