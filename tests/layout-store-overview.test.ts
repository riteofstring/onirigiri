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
});
