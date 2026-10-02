import { describe, expect, it } from "vitest";
import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { createWorkspaceScene } from "../src/workspace/workspace-scene";

describe("layout request work", () => {
  it("resolves reserved-cell geometry only while a reserved cell exists", () => {
    const { scene } = createWorkspaceScene({
      panes: [{ paneId: "pane", surfaceKind: "test", title: "Pane" }],
    });
    const engine = new WorkspaceLikeLayoutEngine(scene);
    let sizingReads = 0;
    engine.setPaneDefaults({
      paneDefaults: {
        get minWidth() {
          sizingReads++;
          return 100;
        },
      },
    });
    const frame = {
      focusedPaneId: "pane",
      maximizedPaneId: null,
      movementPhase: "idle" as const,
      presentationMode: "normal" as const,
      scrollColumn: 0,
      scrollRow: 0,
      viewport: { x: 0, y: 0, width: 900, height: 700 },
    };
    sizingReads = 0;
    expect(engine.reservedCellRenderItems(frame)).toEqual([]);
    expect(sizingReads).toBe(0);
    expect(engine.createReservedBlankSplit("pane", "down")).toBe(true);
    const reserved = engine.reservedCellRenderItems(frame);
    expect(reserved).toHaveLength(1);
    expect(reserved[0]!.width).toBeGreaterThanOrEqual(100);
    expect(reserved[0]!.height).toBeGreaterThan(0);
    expect(sizingReads).toBeGreaterThan(0);
    expect(engine.removeReservedBlankSplit("pane", "down")).toBe(true);
    sizingReads = 0;
    expect(engine.reservedCellRenderItems(frame)).toEqual([]);
    expect(sizingReads).toBe(0);
  });

  it.each([false, true])(
    "resolves distant signed camera targets with compact mode %s",
    (compact) => {
      const { scene } = createWorkspaceScene({
        padding: 10,
        columnGap: 8,
        panes: [
          {
            paneId: "middle",
            columnId: "middle",
            planeIndex: 0,
            slotIndex: 1,
            heightPx: 200,
            columnWidth: { unit: "px", value: 320 },
            surfaceKind: "test",
            title: "Middle",
          },
        ],
      });
      const engine = new WorkspaceLikeLayoutEngine(scene);
      const viewport = { x: 0, y: 0, width: 800, height: 600 };
      engine.setCompactLayout(compact);

      for (const coordinate of [-1_000_000, 1_000_000]) {
        const cursor = {
          column: coordinate,
          row: coordinate,
          split: 99,
        };
        const cell = engine.gridCellBox(cursor, viewport);
        const start = engine.gridCameraTarget(cursor, viewport, "start");
        const centered = engine.gridCameraTarget(cursor, viewport, "center");
        expect(cell).toMatchObject({
          kind: "empty",
          structural: false,
          cursor: { column: coordinate, row: coordinate, split: 0 },
        });
        expect(start.scrollColumn).toBe(coordinate);
        expect(centered.scrollColumn).toBe(coordinate);
        expect(Math.sign(start.scrollRow)).toBe(Math.sign(coordinate));
        expect(Math.sign(centered.scrollRow)).toBe(Math.sign(coordinate));
      }

      engine.resizePane("middle", 340);
      const resized = engine.gridCameraTarget(
        { column: 1_000_000, row: 1_000_000, split: 0 },
        { ...viewport, height: 700 },
        "center",
        "middle",
      );
      expect(resized.scrollColumn).toBe(1_000_000);
      expect(Number.isFinite(resized.scrollRow)).toBe(true);
    },
  );

  it.each([false, true])(
    "keeps geometry work independent of coordinate distance with compact mode %s",
    (compact) => {
      const { scene } = createWorkspaceScene({
        panes: Array.from({ length: 30 }, (_, index) => ({
          paneId: `pane-${index}`,
          columnId: `column-${Math.floor(index / 2)}`,
          columnWidth: {
            unit: "px" as const,
            value: 320 + ((Math.floor(index / 2) % 5) % 3) * 40,
          },
          heightPx: 120 + (index % 2) * 80,
          planeIndex: Math.floor(index / 10),
          slotIndex: Math.floor(index / 2) % 5,
          surfaceKind: "test",
          title: String(index),
        })),
      });
      const engine = new WorkspaceLikeLayoutEngine(scene);
      engine.setCompactLayout(compact);
      let configurationReads = 0;
      engine.setPaneDefaults({
        paneDefaults: {
          get minWidth() {
            configurationReads++;
            return 100;
          },
        },
      });
      const viewport = { x: 0, y: 0, width: 900, height: 700 };
      for (const maximized of [null, "pane-0"]) {
        configurationReads = 0;
        const boxes = engine.paneWorldBoxes(viewport, maximized);
        expect(boxes).toHaveLength(30);
        expect(boxes[0]).toMatchObject({
          paneId: "pane-0",
          width: compact ? 900 : maximized ? 880 : 320,
        });
        expect(configurationReads).toBeLessThanOrEqual(30 * 4);

        const readsForDistance = (coordinate: number) => {
          configurationReads = 0;
          const cell = engine.gridCellBox(
            { column: coordinate, row: coordinate, split: 0 },
            viewport,
            maximized,
          );
          expect(cell).toMatchObject({ kind: "empty", structural: false });
          return configurationReads;
        };
        const nearbyReads = readsForDistance(20);
        const distantReads = readsForDistance(1_000_000);
        expect(distantReads).toBe(nearbyReads);
        expect(distantReads).toBeLessThanOrEqual(30 * 4);

        const cameraReadsForDistance = (coordinate: number) => {
          configurationReads = 0;
          const target = engine.gridCameraTarget(
            { column: coordinate, row: -coordinate, split: 0 },
            viewport,
            "center",
            maximized,
          );
          expect(target.scrollColumn).toBe(coordinate);
          return configurationReads;
        };
        const nearbyCameraReads = cameraReadsForDistance(20);
        const distantCameraReads = cameraReadsForDistance(1_000_000);
        expect(distantCameraReads).toBe(nearbyCameraReads);
        expect(distantCameraReads).toBeLessThanOrEqual(30 * 10);
      }
      const resized = { ...viewport, width: 760, height: 640 };
      expect(engine.paneWorldBoxes(resized, "pane-0")[0]!.width).toBe(
        compact ? 760 : 740,
      );
    },
  );
});
