import { describe, expect, it, vi } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import { createWorkspaceScene } from "../src/workspace/workspace-scene";

describe("WorkspaceLayoutStore mutation metadata", () => {
  it("publishes complete commands once while keeping frame updates and workspaces independent", () => {
    const create = () => {
      const { cursor, scene } = createWorkspaceScene({
        panes: [
          {
            paneId: "one",
            columnId: "one",
            slotIndex: 0,
            surfaceKind: "test",
            title: "One",
          },
          {
            paneId: "two",
            columnId: "two",
            slotIndex: 1,
            surfaceKind: "test",
            title: "Two",
          },
        ],
      });
      return new WorkspaceLayoutStore(
        new WorkspaceLikeLayoutEngine(scene),
        scene,
        cursor,
      );
    };
    const store = create();
    const independent = create();
    const before = store.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.focusPane("two");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(store.getSnapshot());
    expect(store.getSnapshot()).toMatchObject({
      focusedPaneId: "two",
      cursor: { column: 1 },
      revision: before.revision + 1,
    });
    expect(before.focusedPaneId).toBe("one");
    const commanded = store.getSnapshot();
    store.advanceFrame(16);
    expect(store.getSnapshot()).not.toBe(commanded);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(independent.getSnapshot().focusedPaneId).toBe("one");
    unsubscribe();
    store.focusPane("one");
    expect(listener).toHaveBeenCalledTimes(1);
    const laterSubscriber = vi.fn();
    const cameraSubscriber = vi.fn(
      (snapshot: ReturnType<WorkspaceLayoutStore["getSnapshot"]>) => {
        expect(snapshot.focusedPaneId).toBe("two");
        store.advanceFrame(16);
        expect(laterSubscriber).not.toHaveBeenCalled();
      },
    );
    store.subscribe(cameraSubscriber);
    store.subscribe(laterSubscriber);
    store.focusPane("two");
    expect(cameraSubscriber).toHaveBeenCalledTimes(1);
    expect(laterSubscriber).toHaveBeenCalledTimes(1);
    expect(laterSubscriber.mock.calls[0]?.[0]).toBe(
      cameraSubscriber.mock.calls[0]?.[0],
    );
  });

  it("uses one mutation ID for a complete pointer resize gesture", () => {
    const { cursor, scene } = createWorkspaceScene({
      panes: [
        {
          columnId: "column",
          paneId: "pane",
          surfaceKind: "test",
          title: "Pane",
        },
      ],
    });
    const engine = new WorkspaceLikeLayoutEngine(scene);
    const store = new WorkspaceLayoutStore(engine, scene, cursor);

    store.beginLayoutMutationGroup();
    store.resizeColumn("column", { unit: "px", value: 420 });
    const firstUpdate = store.getSnapshot();
    store.resizePaneRow("pane", 240);
    const secondUpdate = store.getSnapshot();
    store.endLayoutMutationGroup();
    store.resizeColumn("column", { unit: "px", value: 440 });

    expect(firstUpdate.layoutMutationId).toBe(secondUpdate.layoutMutationId);
    expect(secondUpdate.layoutRevision).toBe(firstUpdate.layoutRevision + 1);
    expect(store.getSnapshot().layoutMutationId).toBe(
      secondUpdate.layoutMutationId + 1,
    );
  });
});
