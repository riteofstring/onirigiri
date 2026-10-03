import { expect, test } from "vitest";

import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
} from "../src/index.js";

test("duplicate pane ids name the id and both entries", () => {
  expect(() =>
    createWorkspaceScene({
      panes: [
        { paneId: "notes", surfaceKind: "note", title: "Notes" },
        { paneId: "map", surfaceKind: "note", title: "Map" },
        { paneId: "notes", surfaceKind: "note", title: "More notes" },
      ],
    }),
  ).toThrow(
    'Onirigiri: paneId "notes" is used by more than one pane (entries 0 and 2); each pane needs its own paneId.',
  );
});

test("a saved layout placing an unknown pane says which pane and column", () => {
  const panes = [{ paneId: "notes", surfaceKind: "note", title: "Notes" }];
  const { scene, cursor } = createWorkspaceScene({ panes });
  const saved = serializeWorkspaceLayout(scene, cursor);
  const column = saved.columns[0]!;
  const layout = {
    ...saved,
    columns: [{ ...column, cells: [{ ...column.cells[0]!, paneId: "ghost" }] }],
  };
  expect(() => createWorkspaceScene({ panes, initialLayout: layout })).toThrow(
    `Onirigiri layout places pane "ghost" in column ${column.columnId}, but its panes list has no such pane.`,
  );
});

test("a saved layout placing one pane twice names both columns", () => {
  const panes = [
    { paneId: "notes", surfaceKind: "note", title: "Notes" },
    { paneId: "map", surfaceKind: "note", title: "Map" },
  ];
  const { scene, cursor } = createWorkspaceScene({ panes });
  const saved = serializeWorkspaceLayout(scene, cursor);
  const [first, second] = saved.columns;
  const layout = {
    ...saved,
    columns: [
      first!,
      { ...second!, cells: [{ ...second!.cells[0]!, paneId: "notes" }] },
    ],
  };
  expect(() => createWorkspaceScene({ panes, initialLayout: layout })).toThrow(
    `Onirigiri layout places pane "notes" in both column ${first!.columnId} and column ${second!.columnId}; a pane can appear only once.`,
  );
});
