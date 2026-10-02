import { describe, expect, it } from "vitest";

import {
  adjacentHistoryLayout,
  emptyLayoutHistory,
  initializeLayoutHistory,
  layoutHistoryLimit,
  recordLayoutHistory,
} from "../two-dimensional/src/layout-history";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
} from "@riteofstring/onirigiri";

describe("two-dimensional playground layout history", () => {
  it("coalesces one mutation, truncates redo, and remains bounded", () => {
    const history = emptyLayoutHistory();
    const initial = layoutWithTitle("Initial");
    const dragStart = layoutWithTitle("Drag start");
    const dragEnd = layoutWithTitle("Drag end");
    const secondCommand = layoutWithTitle("Second command");

    expect(initializeLayoutHistory(history, initial)).toBe(true);
    expect(recordLayoutHistory(history, dragStart, 1)).toBe(true);
    expect(recordLayoutHistory(history, dragEnd, 1)).toBe(false);
    expect(history.entries).toHaveLength(2);
    expect(history.entries[1]?.panes[0]?.title).toBe("Drag end");
    expect(recordLayoutHistory(history, secondCommand, 2)).toBe(true);
    expect(adjacentHistoryLayout(history, "undo")).toEqual(dragEnd);
    expect(recordLayoutHistory(history, layoutWithTitle("Branched"), 3)).toBe(
      true,
    );
    expect(adjacentHistoryLayout(history, "redo")).toBeNull();

    for (let index = 0; index < layoutHistoryLimit + 3; index += 1) {
      recordLayoutHistory(
        history,
        layoutWithTitle(`Command ${index}`),
        index + 4,
      );
    }
    expect(history.entries).toHaveLength(layoutHistoryLimit);
  });
});

function layoutWithTitle(title: string) {
  const { cursor, scene } = createWorkspaceScene({
    panes: [{ paneId: "pane", surfaceKind: "test", title }],
  });
  return serializeWorkspaceLayout(scene, cursor);
}
