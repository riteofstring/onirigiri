import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import { dispatchShortcutAction } from "../src/input/workspace-shortcut-runtime";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
} from "../src/workspace/workspace-scene";

describe("workspace shortcut runtime", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("moves into an empty grid cell without queueing a DOM focus transfer", () => {
    const { cursor, scene } = createWorkspaceScene({
      panes: ["source", "terminal"].map((paneId, slotIndex) => ({
        columnId: `${paneId}-column`,
        paneId,
        slotIndex,
        surfaceKind: "test",
        title: paneId,
      })),
    });
    const engine = new WorkspaceLikeLayoutEngine(scene);
    const store = new WorkspaceLayoutStore(engine, scene, cursor);
    const viewport = { height: 900, width: 1200, x: 0, y: 0 };
    expect(store.moveFocus("right", viewport)).toBe(true);
    expect(store.focusedPaneId()).toBe("terminal");

    const workspace = document.createElement("div");
    workspace.className = "onirigiri-workspace";
    const staleHost = document.createElement("section");
    staleHost.className = "onirigiri-pane";
    staleHost.dataset.onirigiriPaneId = "source";
    staleHost.tabIndex = -1;
    workspace.append(staleHost);
    document.body.append(workspace);
    staleHost.focus();

    const snapshot = store.getSnapshot();
    const layout = serializeWorkspaceLayout(engine.toScene(), snapshot.cursor);
    expect(
      dispatchShortcutAction("focusRight", store, viewport, workspace),
    ).toEqual({
      announcement: null,
      changed: true,
      pendingFocusPaneId: null,
    });
    expect(store.getSnapshot()).toMatchObject({
      cursor: { column: 2, row: 0, split: 0 },
      focusedPaneId: null,
    });
    expect(store.getSnapshot()).not.toEqual(snapshot);
    expect(serializeWorkspaceLayout(engine.toScene(), snapshot.cursor)).toEqual(
      layout,
    );
    expect(document.activeElement).toBe(staleHost);
  });
});
