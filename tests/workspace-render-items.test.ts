import { describe, expect, it, vi } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import {
  WorkspaceLayoutStore,
  type WorkspaceLayoutSnapshot,
} from "../src/state/layout-store";
import type {
  PaneRenderItem,
  PaneWorldBox,
  Rect,
  ReservedCellRenderItem,
} from "../src/types";
import {
  workspaceMotionSceneItems,
  WorkspaceMotionSceneInventory,
} from "../src/presentation/workspace-motion-scene-inventory";
import { workspacePaneRearrangementSweep } from "../src/presentation/workspace-pane-rearrangement-sweep";
import {
  workspaceGridCursorRenderItem,
  workspaceRenderItems,
  workspaceReservedCellRenderItems,
  workspaceWorldRenderFrame,
  WorkspaceRenderItemRenderer,
  type WorkspaceRenderItemsInput,
} from "../src/presentation/workspace-render-items";
import { createWorkspaceScene } from "../src/workspace/workspace-scene";
import { completePaneShells } from "../src/presentation/workspace-sweep-geometry";

const viewport: Rect = { height: 540, width: 360, x: 0, y: 0 };

describe("workspace world render items", () => {
  it("completes an existing shell inventory without copying the scene", () => {
    const { engine, store } = workspace();
    const input = {
      engine,
      snapshot: store.getSnapshot(),
      viewport,
      compactLayout: false,
      moving: false,
    };
    const items = workspaceRenderItems(input);
    const boxes = engine.paneWorldBoxes(viewport);
    const readScene = vi.spyOn(engine, "toScene");
    try {
      expect(completePaneShells(input, items, boxes)).toBe(items);
      expect(items.map((item) => item.paneId).sort()).toEqual(
        boxes.map((box) => box.paneId).sort(),
      );
      expect(readScene).not.toHaveBeenCalled();
    } finally {
      readScene.mockRestore();
    }
  });
  it.each([100, 500])(
    "bounds scene traversal while completing %s pane shells and observes later moves",
    (count) => {
      const { scene, cursor } = createWorkspaceScene({
        panes: Array.from({ length: count }, (_, index) => ({
          paneId: `shell-${index}`,
          columnId: `column-${index}`,
          planeIndex: Math.floor(index / 10),
          slotIndex: index % 10,
          heightPx: 400 + (index % 3) * 20,
          columnWidth: { unit: "px" as const, value: 300 + (index % 2) * 40 },
          surfaceKind: "test",
          title: `Shell ${index}`,
        })),
      });
      const engine = new WorkspaceLikeLayoutEngine(scene);
      const store = new WorkspaceLayoutStore(engine, scene, cursor);
      const boxes = engine.paneWorldBoxes(viewport);
      const current = engine.toScene();
      let cellReads = 0;
      current.columns = current.columns.map((column) => ({
        ...column,
        get cells() {
          cellReads++;
          return column.cells;
        },
      }));
      const readScene = vi.spyOn(engine, "toScene").mockReturnValue(current);
      try {
        const input = { engine, moving: true, snapshot: store.getSnapshot() };
        const shells = completePaneShells(input, [], boxes);
        expect(shells).toHaveLength(count);
        for (const [index, shell] of shells.entries()) {
          expect(shell).toMatchObject({
            ...boxes[index],
            paneId: `shell-${index}`,
            planeIndex: Math.floor(index / 10),
            moving: true,
            runtimeState: "hidden",
            visible: false,
          });
        }
        expect(cellReads).toBeLessThanOrEqual(count * 2);
        current.columns[0]!.planeIndex = -3;
        cellReads = 0;
        const moved = completePaneShells(input, [], boxes);
        expect(moved[0]!.planeIndex).toBe(-3);
        expect(cellReads).toBeLessThanOrEqual(count * 2);
      } finally {
        readScene.mockRestore();
      }
    },
  );

  it("retains the swept pane inventory as overview advances and layout inputs change", () => {
    const { engine, store } = workspace();
    store.ensureFocusedPaneVisible(viewport);
    store.toggleOverviewMode();
    const renderer = new WorkspaceRenderItemRenderer();
    const overview = store.getSnapshot();
    const inputs = [0.1, 0.3, 0.6, 0.9].map((overviewProgress) =>
      renderInput(engine, { ...overview, overviewProgress }, true),
    );
    inputs.push({
      ...inputs[2]!,
      viewport: { ...viewport, width: 760, height: 840 },
    });
    for (const input of inputs) {
      const expected = workspaceRenderItems(input);
      expect(renderer.render(input)).toEqual(expected);
    }
    const changed = inputs[2]!;
    renderer.render(changed);
    engine.setPaneDefaults({ paneDefaults: { width: 180 } });
    expect(renderer.render(changed)).toEqual(workspaceRenderItems(changed));
    renderer.reset();
    expect(renderer.render(changed)).toEqual(workspaceRenderItems(changed));
  });

  it("resolves canonical pane geometry in one bulk pass", () => {
    const { engine, store } = workspace();
    store.ensureFocusedPaneVisible(viewport);
    const bulkGeometry = vi.spyOn(engine, "paneWorldBoxes");
    const singleCellGeometry = vi.spyOn(engine, "gridCellBox");

    const items = workspaceRenderItems(
      renderInput(engine, store.getSnapshot(), false),
    );

    expect(items).toHaveLength(7);
    expect(bulkGeometry).toHaveBeenCalledTimes(1);
    expect(singleCellGeometry).not.toHaveBeenCalled();
  });

  it("keeps panes and the cursor registered to one world frame across normal, overview pan, and overview zoom", () => {
    const { engine, store } = workspace();
    store.ensureFocusedPaneVisible(viewport);

    expectSharedProjection(engine, store.getSnapshot(), false);

    store.toggleOverviewMode();
    store.snapAnimationsToTarget();
    const overview = store.getSnapshot();
    expectSharedProjection(engine, overview, false);

    const pannedAndZoomed = {
      ...overview,
      overviewFixedScale: undefined,
      overviewPanX: 42,
      overviewPanY: 0,
      overviewZoom: 1.5,
    };
    const overviewFrame = workspaceWorldRenderFrame(
      renderInput(engine, overview, false),
    );
    const pannedAndZoomedFrame = workspaceWorldRenderFrame(
      renderInput(engine, pannedAndZoomed, false),
    );
    const overviewItems = workspaceRenderItems(
      renderInput(engine, overview, false),
    );
    const pannedAndZoomedItems = workspaceRenderItems(
      renderInput(engine, pannedAndZoomed, false),
    );

    expect(pannedAndZoomedFrame.scale).not.toBeCloseTo(overviewFrame.scale, 4);
    expect(pannedAndZoomedFrame.x).not.toBeCloseTo(overviewFrame.x, 4);
    expectSameWorldPaneGeometry(overviewItems, pannedAndZoomedItems);
    expectSharedProjection(engine, pannedAndZoomed, false);
  });

  it("keeps every displayed overview pane paused after motion settles", () => {
    const { engine, store } = workspace();
    store.ensureFocusedPaneVisible(viewport);
    store.toggleOverviewMode();
    store.snapAnimationsToTarget();

    const items = workspaceRenderItems(
      renderInput(engine, store.getSnapshot(), false),
    ).filter((item) => item.visible);

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.runtimeState === "frozen")).toBe(true);
    expect(items.every((item) => item.preload === undefined)).toBe(true);

    store.toggleOverviewMode();
    store.snapAnimationsToTarget();
    const normalItems = workspaceRenderItems(
      renderInput(engine, store.getSnapshot(), false),
    ).filter((item) => item.visible);

    expect(normalItems.length).toBeGreaterThan(0);
    expect(normalItems.every((item) => item.runtimeState === "live")).toBe(
      true,
    );
  });

  it("keeps every shell in world geometry outside the active content viewport", () => {
    const { cursor, scene } = createWorkspaceScene({
      panes: Array.from({ length: 30 }, (_, index) => ({
        columnId: `motion-column-${index.toString()}`,
        columnWidth: { unit: "px" as const, value: 280 },
        paneId: `motion-pane-${index.toString()}`,
        slotIndex: index,
        surfaceKind: "test",
        title: `Motion pane ${index.toString()}`,
      })),
      renderOverscanColumns: 1,
    });
    const engine = new WorkspaceLikeLayoutEngine(scene);
    const store = new WorkspaceLayoutStore(engine, scene, cursor);
    const input = renderInput(engine, store.getSnapshot(), false);
    const rendered = workspaceRenderItems(input);
    const motionScene = workspaceMotionSceneItems(input, rendered);

    expect(rendered).toHaveLength(scene.panes.length);
    expect(rendered.at(-1)).toMatchObject({
      paneId: "motion-pane-29",
      opacity: 1,
      runtimeState: "hidden",
      visible: false,
    });
    expect(motionScene).toHaveLength(scene.panes.length);
    expect(motionScene.at(-1)).toMatchObject({
      paneId: "motion-pane-29",
      preload: false,
      visible: true,
    });
  });

  it("reuses motion geometry across focus and presentation changes", () => {
    const { engine, store } = workspace();
    store.ensureFocusedPaneVisible(viewport);
    const inventory = new WorkspaceMotionSceneInventory();
    const initialInput = renderInput(engine, store.getSnapshot(), false);
    inventory.resolve(initialInput, workspaceRenderItems(initialInput));

    expect(store.focusPane("pane-4")).toBe(true);
    const focusedInput = renderInput(engine, store.getSnapshot(), true);
    expect(inventory.cachedItemKey(focusedInput)).not.toBeNull();

    store.toggleOverviewMode();
    const overviewInput = renderInput(engine, store.getSnapshot(), true);
    expect(inventory.cachedItemKey(overviewInput)).not.toBeNull();
  });

  it("preloads only the peripheral pane in the swept viewport before it crosses the normal edge", () => {
    const { engine, store } = workspace();
    store.ensureFocusedPaneVisible(viewport);
    expect(store.focusPane("pane-4")).toBe(true);
    const snapshot = store.getSnapshot();
    const input = renderInput(engine, snapshot, true);
    const items = workspaceRenderItems(input);
    const entering = requiredItem(items, "pane-4");
    const farther = requiredItem(items, "pane-6");
    const currentFrame = workspaceWorldRenderFrame(input);
    const targetFrame = workspaceWorldRenderFrame({
      ...input,
      snapshot: {
        ...snapshot,
        horizontalAnchorOffset: snapshot.targetHorizontalAnchorOffset,
        scrollColumn: snapshot.targetScrollColumn,
        scrollRow: snapshot.targetScrollRow,
      },
    });

    expect(entering.preload).toBe(true);
    expect(projectedLeft(entering, currentFrame)).toBeGreaterThanOrEqual(
      viewport.x + viewport.width,
    );
    expect(projectedLeft(entering, targetFrame)).toBeLessThan(
      viewport.x + viewport.width,
    );
    expect(
      projectedLeft(entering, targetFrame) +
        entering.width * entering.scale * targetFrame.scale,
    ).toBeGreaterThan(viewport.x);
    expect(farther.preload).toBeUndefined();
  });

  it("preloads every pane in a long camera corridor before motion starts", () => {
    const { engine, store } = workspace();
    store.ensureFocusedPaneVisible(viewport);
    expect(store.focusPane("pane-6")).toBe(true);

    const items = workspaceRenderItems(
      renderInput(engine, store.getSnapshot(), true),
    );

    expect(requiredItem(items, "pane-2")).toMatchObject({
      preload: true,
      runtimeState: "frozen",
      visible: true,
    });
    expect(requiredItem(items, "pane-3")).toMatchObject({
      preload: true,
      runtimeState: "frozen",
      visible: true,
    });
    expect(requiredItem(items, "pane-4")).toMatchObject({
      preload: true,
      runtimeState: "frozen",
      visible: true,
    });
  });

  it("keeps a culled nonfocused Fixed group entrant continuous from its captured world box", () => {
    const narrowViewport = { ...viewport, width: 240 };
    const { cursor: sourceCursor, scene: sourceScene } = createWorkspaceScene({
      panes: [
        paneAt("anchor", 0),
        paneAt("lead", 1, "moving-column"),
        paneAt("peripheral", 1, "moving-column"),
      ],
    });
    const sourceEngine = new WorkspaceLikeLayoutEngine(sourceScene);
    const sourceStore = new WorkspaceLayoutStore(
      sourceEngine,
      sourceScene,
      sourceCursor,
      {
        initialCameraModes: { normal: "fixed", overview: "fixed" },
        initialFocusAnchor: "start",
      },
    );
    sourceStore.ensureFocusedPaneVisible(narrowViewport);
    expect(sourceStore.cameraMode()).toBe("fixed");
    expect(sourceStore.focusPaneWithoutReveal("lead")).toBe(true);
    expect(sourceStore.selectFocusedPaneGroup()).toBe(true);
    expect(sourceStore.moveSelectedPaneGroup("left")).toBe(true);
    const targetSnapshot = sourceStore.getSnapshot();
    const source = sourceStore.paneRearrangementSourceFor(
      targetSnapshot.paneRearrangementRevision,
    );
    if (!source) {
      throw new Error("missing captured Fixed rearrangement source");
    }
    const input = {
      ...renderInput(sourceEngine, targetSnapshot, true),
      viewport: narrowViewport,
    };
    const swept = workspacePaneRearrangementSweep(input, [], source);
    const entering = requiredItem(swept.items, "peripheral");
    const sourceBox = requiredWorldBox(swept.sourceItems, "peripheral");
    const sourceGeometryEngine = sourceEngine.forkForWorldGeometry(
      source.scene,
    );
    const sourceFrame = workspaceWorldRenderFrame({
      ...input,
      engine: sourceGeometryEngine,
      moving: false,
      snapshot: source.snapshot,
    });
    const targetFrame = workspaceWorldRenderFrame(input);

    expect(projectedLeft(sourceBox, sourceFrame)).toBeGreaterThan(
      narrowViewport.x + narrowViewport.width - sourceScene.columnGap,
    );
    expect(projectedLeft(entering, targetFrame)).toBeLessThan(
      narrowViewport.x + narrowViewport.width,
    );
    expect(sourceBox.x).not.toBeCloseTo(entering.x, 4);
    expect(entering).toMatchObject({
      focused: false,
      paneId: "peripheral",
      preload: true,
      runtimeState: "frozen",
      visible: true,
    });
  });

  it("projects reserved split geometry through the same normal and overview world frame", () => {
    const { engine, store } = workspace();
    store.ensureFocusedPaneVisible(viewport);
    expect(store.createFocusedReservedBlankSplit("down")).toBe(true);

    expectSharedReservedProjection(engine, store.getSnapshot(), false);

    store.toggleOverviewMode();
    store.snapAnimationsToTarget();
    expectSharedReservedProjection(engine, store.getSnapshot(), false);
  });
});

function workspace(): {
  engine: WorkspaceLikeLayoutEngine;
  store: WorkspaceLayoutStore;
} {
  const { cursor, scene } = createWorkspaceScene({
    panes: Array.from({ length: 7 }, (_, index) => ({
      columnId: `column-${index.toString()}`,
      columnWidth: { unit: "px" as const, value: 280 },
      paneId: `pane-${index.toString()}`,
      slotIndex: index,
      surfaceKind: "test",
      title: `Pane ${index.toString()}`,
    })),
  });
  const engine = new WorkspaceLikeLayoutEngine(scene);
  return { engine, store: new WorkspaceLayoutStore(engine, scene, cursor) };
}

function paneAt(
  paneId: string,
  slotIndex: number,
  columnId = `column-${paneId}`,
) {
  return {
    columnId,
    columnWidth: { unit: "px" as const, value: 280 },
    paneId,
    slotIndex,
    surfaceKind: "test",
    title: paneId,
  };
}

function expectSharedProjection(
  engine: WorkspaceLikeLayoutEngine,
  snapshot: WorkspaceLayoutSnapshot,
  moving: boolean,
): void {
  const input = renderInput(engine, snapshot, moving);
  const frame = workspaceWorldRenderFrame(input);
  const items = workspaceRenderItems(input);
  const screenItems = screenPaneItems(engine, snapshot, moving);
  const worldCursor = workspaceGridCursorRenderItem(input);
  const screenCursor = engine.gridCursorRenderItem(
    layoutFrame(snapshot, moving),
  );

  expect(frame.x + frame.scale * frame.grid.x).toBeCloseTo(viewport.x, 4);
  expect(frame.y + frame.scale * frame.grid.y).toBeCloseTo(viewport.y, 4);
  expect(frame.grid.width * frame.scale).toBeCloseTo(viewport.width, 4);
  expect(frame.grid.height * frame.scale).toBeCloseTo(viewport.height, 4);

  for (const screenItem of screenItems) {
    const worldItem = requiredItem(items, screenItem.paneId);
    expect(projectedLeft(worldItem, frame)).toBeCloseTo(screenItem.x, 4);
    expect(projectedTop(worldItem, frame)).toBeCloseTo(screenItem.y, 4);
    expect(worldItem.scale * frame.scale).toBeCloseTo(screenItem.scale, 4);
  }
  expect(frame.x + frame.scale * worldCursor.x).toBeCloseTo(screenCursor.x, 4);
  expect(frame.y + frame.scale * worldCursor.y).toBeCloseTo(screenCursor.y, 4);
  expect(worldCursor.scale * frame.scale).toBeCloseTo(screenCursor.scale, 4);
}

function expectSharedReservedProjection(
  engine: WorkspaceLikeLayoutEngine,
  snapshot: WorkspaceLayoutSnapshot,
  moving: boolean,
): void {
  const input = renderInput(engine, snapshot, moving);
  const frame = workspaceWorldRenderFrame(input);
  const worldItems = workspaceReservedCellRenderItems(input);
  const screenItems = engine.reservedCellRenderItems(
    layoutFrame(snapshot, moving),
  );

  expect(worldItems).toHaveLength(screenItems.length);
  for (const screenItem of screenItems) {
    const worldItem = requiredReservedItem(worldItems, screenItem);
    expect(frame.x + frame.scale * worldItem.x).toBeCloseTo(screenItem.x, 4);
    expect(frame.y + frame.scale * worldItem.y).toBeCloseTo(screenItem.y, 4);
    expect(worldItem.scale * frame.scale).toBeCloseTo(screenItem.scale, 4);
  }
}

type WorkspaceRenderInput = WorkspaceRenderItemsInput & {
  engine: WorkspaceLikeLayoutEngine;
};

function renderInput(
  engine: WorkspaceLikeLayoutEngine,
  snapshot: WorkspaceLayoutSnapshot,
  moving: boolean,
): WorkspaceRenderInput {
  return {
    compactLayout: false,
    engine,
    moving,
    snapshot,
    viewport,
  };
}

function layoutFrame(snapshot: WorkspaceLayoutSnapshot, moving: boolean) {
  return {
    cursor: snapshot.cursor,
    focusedPaneId: snapshot.focusedPaneId,
    horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
    maximizedPaneId: snapshot.maximizedPaneId,
    movementPhase: moving ? ("moving" as const) : ("idle" as const),
    overviewFixedScale: snapshot.overviewFixedScale,
    overviewFollowOffsetX: snapshot.overviewFollowOffsetX,
    overviewFollowOffsetY: snapshot.overviewFollowOffsetY,
    overviewPanX: snapshot.overviewPanX,
    overviewPanY: snapshot.overviewPanY,
    overviewZoom: snapshot.overviewZoom,
    presentationMode: snapshot.presentationMode,
    scrollColumn: snapshot.scrollColumn,
    scrollRow: snapshot.scrollRow,
    viewport,
  };
}

function screenPaneItems(
  engine: WorkspaceLikeLayoutEngine,
  snapshot: WorkspaceLayoutSnapshot,
  moving: boolean,
): PaneRenderItem[] {
  const items: PaneRenderItem[] = [];
  engine.renderFrame(layoutFrame(snapshot, moving), (item) => items.push(item));
  return items;
}

function requiredItem(
  items: readonly PaneRenderItem[],
  paneId: string,
): PaneRenderItem {
  const item = items.find((candidate) => candidate.paneId === paneId);
  if (!item) {
    throw new Error(`missing pane ${paneId}`);
  }
  return item;
}

function requiredWorldBox(
  items: readonly PaneWorldBox[],
  paneId: string,
): PaneWorldBox {
  const item = items.find((candidate) => candidate.paneId === paneId);
  if (!item) {
    throw new Error(`missing world pane ${paneId}`);
  }
  return item;
}

function requiredReservedItem(
  items: readonly ReservedCellRenderItem[],
  expected: ReservedCellRenderItem,
): ReservedCellRenderItem {
  const item = items.find(
    (candidate) =>
      candidate.columnId === expected.columnId &&
      candidate.planeIndex === expected.planeIndex &&
      candidate.rowIndex === expected.rowIndex,
  );
  if (!item) {
    throw new Error(`missing reserved cell ${expected.columnId}`);
  }
  return item;
}

function expectSameWorldPaneGeometry(
  before: readonly PaneRenderItem[],
  after: readonly PaneRenderItem[],
): void {
  expect(after).toHaveLength(before.length);
  for (const beforeItem of before) {
    const afterItem = requiredItem(after, beforeItem.paneId);
    expect(afterItem.x).toBeCloseTo(beforeItem.x, 4);
    expect(afterItem.y).toBeCloseTo(beforeItem.y, 4);
    expect(afterItem.width).toBeCloseTo(beforeItem.width, 4);
    expect(afterItem.height).toBeCloseTo(beforeItem.height, 4);
    expect(afterItem.scale).toBeCloseTo(beforeItem.scale, 4);
  }
}

function projectedLeft(
  item: Pick<PaneWorldBox, "x">,
  frame: ReturnType<typeof workspaceWorldRenderFrame>,
): number {
  return frame.x + frame.scale * item.x;
}

function projectedTop(
  item: PaneRenderItem,
  frame: ReturnType<typeof workspaceWorldRenderFrame>,
): number {
  return frame.y + frame.scale * item.y;
}
