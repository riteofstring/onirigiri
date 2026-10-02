import { describe, expect, it } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import type { PaneRenderItem } from "../src/types";
import { createWorkspaceScene } from "../src/workspace/workspace-scene";

const mobileViewport = { height: 700, width: 390, x: 0, y: 0 };

describe("compact layout geometry", () => {
  it("fills the viewport, separates neighbors by the same gap on both axes and can reveal neighboring hints", () => {
    const engine = compactEngine();

    engine.setCompactLayout(true);
    expect(frame(engine, 0)).toMatchObject([
      { height: 700, paneId: "first", width: 390, x: 0, y: 0 },
      { height: 700, paneId: "second", width: 390, x: 796, y: 0 },
      { height: 700, paneId: "middle", width: 390, x: 398, y: 708 },
    ]);

    engine.setCompactLayout(true, 18);
    expect(frame(engine, 0)).toMatchObject([
      { height: 700, paneId: "first", width: 338, x: 26, y: 0 },
      { height: 700, paneId: "second", width: 338, x: 718, y: 0 },
      { height: 700, paneId: "middle", width: 338, x: 372, y: 708 },
    ]);
    expect(frame(engine, 1)).toMatchObject([
      { height: 700, paneId: "first", width: 338, x: -320, y: 0 },
      { height: 700, paneId: "second", width: 338, x: 372, y: 0 },
      { height: 700, paneId: "middle", width: 338, x: 26, y: 708 },
    ]);
  });

  it("restores desktop padding and stored column widths after compact mode", () => {
    const engine = compactEngine();
    engine.setCompactLayout(true, 18);
    engine.setCompactLayout(false);

    expect(frame(engine, 0)).toMatchObject([
      { height: 680, paneId: "first", width: 320, x: 10, y: 10 },
      { height: 680, paneId: "second", width: 320, x: 666, y: 10 },
      { height: 680, paneId: "middle", width: 320, x: 338, y: 698 },
    ]);
  });
});

function compactEngine(): WorkspaceLikeLayoutEngine {
  return new WorkspaceLikeLayoutEngine(
    createWorkspaceScene({
      panes: [
        {
          columnId: "first-column",
          columnWidth: { unit: "px", value: 320 },
          paneId: "first",
          slotIndex: 0,
          surfaceKind: "test",
          title: "First",
        },
        {
          columnId: "second-column",
          columnWidth: { unit: "px", value: 320 },
          paneId: "second",
          slotIndex: 2,
          surfaceKind: "test",
          title: "Second",
        },
        {
          columnId: "middle-column",
          columnWidth: { unit: "px", value: 320 },
          paneId: "middle",
          planeIndex: 1,
          slotIndex: 1,
          surfaceKind: "test",
          title: "Middle",
        },
      ],
    }).scene,
  );
}

function frame(
  engine: WorkspaceLikeLayoutEngine,
  scrollColumn: number,
): PaneRenderItem[] {
  const items: PaneRenderItem[] = [];
  engine.renderFrame(
    {
      focusedPaneId: scrollColumn === 0 ? "first" : "second",
      maximizedPaneId: null,
      movementPhase: "idle",
      presentationMode: "normal",
      renderAllColumns: true,
      scrollColumn,
      scrollRow: 0,
      viewport: mobileViewport,
    },
    (item) => items.push(item),
  );
  return items;
}
