import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readStoredLayout } from "../shared/persistence";
import type { OnirigiriLayout } from "@riteofstring/onirigiri";

const storageKey = "onirigiri-playground-persistence-test";
const originalLocalStorage = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);
let storedValue: string | null = null;

describe("playground layout persistence", () => {
  beforeEach(() => {
    storedValue = null;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: () => storedValue },
    });
  });

  afterAll(() => {
    if (originalLocalStorage) {
      Object.defineProperty(window, "localStorage", originalLocalStorage);
    }
  });

  it("accepts a complete serialized layout", () => {
    const layout = validLayout();
    storedValue = JSON.stringify(layout);

    expect(readStoredLayout(storageKey)).toEqual(layout);
  });

  it("rejects malformed column geometry before workspace construction", () => {
    const layout = validLayout();
    const malformedLayout = {
      ...layout,
      columns: [{ ...layout.columns[0], widthSpec: undefined }],
    };
    storedValue = JSON.stringify(malformedLayout);

    expect(readStoredLayout(storageKey)).toBeNull();
  });

  it("rejects layouts whose pane ownership graph is inconsistent", () => {
    const layout = validLayout();
    layout.columns[0]?.cells.push({
      paneId: "missing-pane",
      reserved: false,
      weight: 1,
    });
    storedValue = JSON.stringify(layout);

    expect(readStoredLayout(storageKey)).toBeNull();
  });

  it("preserves a reserved blank cell without treating it as a pane owner", () => {
    const layout = validLayout();
    const sourceColumn = layout.columns[0];
    if (!sourceColumn) {
      throw new Error("expected a source column");
    }
    layout.columns.push({
      ...sourceColumn,
      cells: [{ paneId: null, reserved: true, weight: 1 }],
      columnId: "empty-column",
      index: 1,
      slotIndex: 1,
    });
    storedValue = JSON.stringify(layout);

    expect(readStoredLayout(storageKey)).toEqual(layout);
  });
});

function validLayout(): OnirigiriLayout {
  return {
    columns: [
      {
        cells: [{ paneId: "pane-1", reserved: false, weight: 1 }],
        columnId: "column-1",
        idealWidthSpec: { unit: "px", value: 400 },
        index: 0,
        planeIndex: 0,
        slotIndex: 0,
        widthSpec: { unit: "px", value: 400 },
      },
    ],
    cursor: { column: 0, row: 0, split: 0 },
    id: "stored-workspace",
    panes: [
      {
        columnId: "column-1",
        paneId: "pane-1",
        sequence: 0,
        subtitle: "",
        surfaceId: "surface-1",
        surfaceKind: "test",
        title: "Test pane",
        tone: "slate",
      },
    ],
    schemaVersion: 4,
  };
}
