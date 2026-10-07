import { describe, expect, it } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import { createWorkspaceScene } from "../src/workspace/workspace-scene";

describe("workspace overview scale", () => {
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
});
