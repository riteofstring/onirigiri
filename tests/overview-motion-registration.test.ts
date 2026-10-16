import { describe, expect, it } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { PanePresentationEngine } from "../src/presentation/pane-presentation-engine";
import {
  WorkspaceFrameScheduler,
  type WorkspacePresentationBoundaryFrame,
} from "../src/presentation/workspace-frame-scheduler";
import { WorkspaceWorldPresentation } from "../src/presentation/workspace-world-presentation";
import { paneWorldBoxIntersectsRect } from "../src/presentation/workspace-sweep-geometry";
import { WorkspaceGridCursorPresentation } from "../src/workspace/workspace-grid-cursor-presentation";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
} from "../src/workspace/workspace-scene";
import type { FocusDirection, Rect } from "../src/types";

import {
  ManualAnimationFrameHost,
  cameraModes,
  overviewCursorFrame,
  schedulerTestStore,
  viewport,
  visualWorldPaneBox,
} from "./workspace-frame-scheduler-test-support";

const paneIdsInRow = ["a", "b", "c", "d", "e", "f"];

function rowScene() {
  return createWorkspaceScene({
    panes: paneIdsInRow.map((paneId, index) => ({
      columnId: `column-${paneId}`,
      columnWidth: { unit: "px" as const, value: 300 },
      paneId,
      slotIndex: index,
      surfaceKind: "test",
      title: paneId.toUpperCase(),
    })),
  });
}

function negativeSpatialScene() {
  const initial = createWorkspaceScene({
    gridAxes: "spatial",
    panes: paneIdsInRow.map((paneId, index) => ({
      columnId: `column-${paneId}`,
      columnWidth: { unit: "px" as const, value: 280 + 40 * index },
      heightPx: 220 + 35 * index,
      paneId,
      planeIndex: Math.floor(index / 2),
      slotIndex: index % 2,
      surfaceKind: "test",
      title: paneId.toUpperCase(),
    })),
  });
  const layout = serializeWorkspaceLayout(initial.scene, initial.cursor);
  return createWorkspaceScene({
    gridAxes: "spatial",
    initialLayout: {
      ...layout,
      columns: layout.columns.map((column) => ({
        ...column,
        planeIndex: column.planeIndex - 3,
        slotIndex: (column.slotIndex ?? column.index) - 2,
      })),
      cursor: { column: -2, row: -3, split: 0 },
    },
  });
}

function createOverviewHarness({ cursor, scene } = rowScene()) {
  const engine = new WorkspaceLikeLayoutEngine(scene);
  const store = schedulerTestStore(engine, scene, cursor);
  store.ensureFocusedPaneVisible(viewport);
  const presentation = new PanePresentationEngine();
  const hosts = new Map<string, HTMLElement>();
  for (const paneId of paneIdsInRow) {
    const host = document.createElement("section");
    hosts.set(paneId, host);
    presentation.registerPaneHost(paneId, host);
  }
  const world = document.createElement("div");
  const worldGrid = document.createElement("div");
  const cursorHost = document.createElement("div");
  const worldPresentation = new WorkspaceWorldPresentation();
  worldPresentation.bindWorldHost(world, worldGrid);
  const cursorPresentation = new WorkspaceGridCursorPresentation();
  cursorPresentation.bindCursorHost(cursorHost);
  const frameHost = new ManualAnimationFrameHost();
  const presented: WorkspacePresentationBoundaryFrame[] = [];
  const scheduler = new WorkspaceFrameScheduler({
    compactLayoutProvider: () => false,
    cursorPresentation,
    engine,
    frameHost,
    onBoundary: () => undefined,
    onPresentation: (frame) => presented.push(frame),
    presentation,
    store,
    viewportProvider: () => viewport,
    worldPresentation,
  });
  return {
    cursorHost,
    cursorPresentation,
    engine,
    frameHost,
    hosts,
    presented,
    scheduler,
    store,
    world,
    worldPresentation,
  };
}

function transformParts(transform: string): {
  scale: number;
  x: number;
  y: number;
} {
  const translate = /translate(?:3d)?\(([-\d.]+)px, ([-\d.]+)px/.exec(
    transform,
  );
  const scale = /scale\(([-\d.]+)/.exec(transform);
  if (!translate || !scale) {
    throw new Error(`unexpected transform: ${transform}`);
  }
  return {
    scale: Number(scale[1]),
    x: Number(translate[1]),
    y: Number(translate[2]),
  };
}

function intersects(box: Rect, rect: Rect): boolean {
  return (
    box.x + box.width > rect.x &&
    box.x < rect.x + rect.width &&
    box.y + box.height > rect.y &&
    box.y < rect.y + rect.height
  );
}

function onScreenPaneIds(
  harness: ReturnType<typeof createOverviewHarness>,
): Set<string> {
  return new Set(
    [...harness.hosts]
      .filter(
        ([, host]) =>
          !host.hidden &&
          intersects(visualWorldPaneBox(host, harness.world), viewport),
      )
      .map(([paneId]) => paneId),
  );
}

function fraction(value: number, start: number, end: number): number {
  return Math.abs(end - start) < 1e-6 ? 1 : (value - start) / (end - start);
}

type OverviewHarness = ReturnType<typeof createOverviewHarness>;

const motionLayouts = [
  {
    name: "horizontal",
    scene: rowScene,
    direction: "right",
    target: "b",
  },
  {
    name: "negative 2D",
    scene: negativeSpatialScene,
    direction: "down",
    target: "c",
  },
] as const;

function startFocusMotion(
  harness: OverviewHarness,
  mode: "normal" | "overview",
  direction: FocusDirection,
  frames: number,
): void {
  harness.scheduler.start();
  harness.store.setCameraModes(cameraModes("follow", "follow"));
  harness.store.setOverviewCardWidths(160, 160);
  if (mode === "overview") harness.store.toggleOverviewMode();
  harness.frameHost.flushAll();
  expect(harness.store.moveFocus(direction, viewport)).toBe(true);
  harness.frameHost.flushFrames(frames);
}

function expectSamePresentation(left: OverviewHarness, right: OverviewHarness) {
  expect(left.world.style.transform).toBe(right.world.style.transform);
  expect(left.cursorHost.style.transform).toBe(
    right.cursorHost.style.transform,
  );
  expect(left.cursorHost.style.width).toBe(right.cursorHost.style.width);
  expect(left.cursorHost.style.height).toBe(right.cursorHost.style.height);
}

function expectMatchingMotion(
  actual: OverviewHarness,
  control: OverviewHarness,
) {
  expectSamePresentation(actual, control);
  while (control.frameHost.pendingFrameCount() > 0) {
    expect(actual.frameHost.pendingFrameCount()).toBe(1);
    control.frameHost.flushFrames(1);
    actual.frameHost.flushFrames(1);
    expectSamePresentation(actual, control);
  }
  expect(actual.frameHost.pendingFrameCount()).toBe(0);
}

interface MotionSample {
  cursor: number;
  world: number;
}

function expectOnScreenContentActive(
  harness: OverviewHarness,
  frame: WorkspacePresentationBoundaryFrame,
  onScreenDuringMotion: Set<string>,
): void {
  for (const paneId of onScreenPaneIds(harness)) {
    const item = frame.items.find((candidate) => candidate.paneId === paneId);
    expect(
      item !== undefined && paneWorldBoxIntersectsRect(item, frame.world.grid),
      `content of on-screen pane ${paneId} stays active`,
    ).toBe(true);
    if (harness.worldPresentation.hasActiveMotion()) {
      onScreenDuringMotion.add(paneId);
    }
  }
}

function presentNextFrame(
  harness: OverviewHarness,
  onScreenDuringMotion: Set<string>,
): MotionSample | null {
  harness.presented.length = 0;
  harness.frameHost.flushFrames(1);
  const frame = harness.presented.at(-1);
  if (!frame) {
    return null;
  }
  const world = transformParts(harness.world.style.transform);
  expect(frame.world.x).toBeCloseTo(world.x, 2);
  expect(frame.world.y).toBeCloseTo(world.y, 2);
  expect(frame.world.scale).toBeCloseTo(world.scale, 4);
  expectOnScreenContentActive(harness, frame, onScreenDuringMotion);
  return {
    cursor: transformParts(harness.cursorHost.style.transform).x,
    world: world.x,
  };
}

function moveOverviewFocus(
  harness: OverviewHarness,
  direction: FocusDirection,
): number {
  const startWorld = transformParts(harness.world.style.transform);
  const startCursor = transformParts(harness.cursorHost.style.transform);
  const initiallyOnScreen = onScreenPaneIds(harness);
  const onScreenDuringMotion = new Set<string>();
  expect(harness.store.moveFocus(direction, viewport)).toBe(true);
  const destination = overviewCursorFrame(
    harness.engine,
    harness.store.getSnapshot(),
  );
  const samples: MotionSample[] = [];
  while (harness.frameHost.pendingFrameCount() > 0) {
    const sample = presentNextFrame(harness, onScreenDuringMotion);
    if (sample) {
      samples.push(sample);
    }
  }
  const landed = transformParts(harness.cursorHost.style.transform);
  const world = transformParts(harness.world.style.transform);
  expect(world.x + world.scale * landed.x).toBeCloseTo(destination.x, 2);
  expect(world.y + world.scale * landed.y).toBeCloseTo(destination.y, 2);
  const moving = samples.slice(0, -1);
  expect(moving.length).toBeGreaterThan(3);
  for (const sample of moving) {
    expect(
      fraction(sample.cursor, startCursor.x, landed.x),
      "grid cursor and world camera share one motion progress",
    ).toBeCloseTo(fraction(sample.world, startWorld.x, world.x), 3);
  }
  const finallyOnScreen = onScreenPaneIds(harness);
  return [...initiallyOnScreen].filter(
    (paneId) =>
      !finallyOnScreen.has(paneId) && onScreenDuringMotion.has(paneId),
  ).length;
}

describe("overview camera motion registration", () => {
  it.each(motionLayouts)(
    "advances $name overview focus retargets while keeping the cursor registered",
    ({ scene }) => {
      const harness = createOverviewHarness(scene());
      const cursorCenter = () => {
        const world = transformParts(harness.world.style.transform);
        const cursor = transformParts(harness.cursorHost.style.transform);
        return {
          x:
            world.x +
            world.scale *
              (cursor.x +
                (Number.parseFloat(harness.cursorHost.style.width) *
                  cursor.scale) /
                  2),
          y:
            world.y +
            world.scale *
              (cursor.y +
                (Number.parseFloat(harness.cursorHost.style.height) *
                  cursor.scale) /
                  2),
        };
      };
      try {
        harness.scheduler.start();
        harness.store.setCameraModes(cameraModes("follow", "follow"));
        harness.store.setOverviewCardWidths(160, 160);
        harness.store.toggleOverviewMode();
        harness.frameHost.flushAll();
        const initialWorld = harness.world.style.transform;
        const initialCursor = harness.cursorHost.style.transform;
        const initialCenter = cursorCenter();

        expect(harness.store.focusPane("b")).toBe(true);
        expect(harness.store.focusPane("c")).toBe(true);
        harness.frameHost.flushFrames(1);
        expect(harness.world.style.transform).toBe(initialWorld);
        expect(harness.cursorHost.style.transform).toBe(initialCursor);

        for (const paneId of ["b", "c", "b", "c", "b", "c"]) {
          const worldBefore = harness.world.style.transform;
          const cursorBefore = harness.cursorHost.style.transform;
          expect(harness.store.focusPane(paneId)).toBe(true);
          expect(harness.world.style.transform).toBe(worldBefore);
          expect(harness.cursorHost.style.transform).toBe(cursorBefore);
          harness.frameHost.flushFrames(1);
          expect(harness.world.style.transform).not.toBe(worldBefore);
          const center = cursorCenter();
          expect(Math.abs(center.x - initialCenter.x)).toBeLessThan(0.05);
          expect(Math.abs(center.y - initialCenter.y)).toBeLessThan(0.05);
        }

        expect(harness.store.focusPane("a")).toBe(true);
        harness.frameHost.flushAll();
        expect(harness.world.style.transform).toBe(initialWorld);
        expect(harness.cursorHost.style.transform).toBe(initialCursor);
        expect(harness.worldPresentation.hasActiveMotion()).toBe(false);
        expect(harness.cursorPresentation.hasActiveMotion()).toBe(false);
      } finally {
        harness.scheduler.teardown();
      }
    },
  );

  it.each(motionLayouts)(
    "cancels $name overview focus returned before the first advancing frame",
    ({ scene }) => {
      const harness = createOverviewHarness(scene());
      try {
        harness.scheduler.start();
        harness.store.setCameraModes(cameraModes("follow", "follow"));
        harness.store.setOverviewCardWidths(160, 160);
        harness.store.toggleOverviewMode();
        harness.frameHost.flushAll();
        const initialWorld = harness.world.style.transform;
        const initialCursor = harness.cursorHost.style.transform;

        expect(harness.store.focusPane("b")).toBe(true);
        harness.frameHost.flushFrames(1);
        expect(harness.store.focusPane("a")).toBe(true);
        expect(harness.worldPresentation.hasActiveMotion()).toBe(false);
        expect(harness.cursorPresentation.hasActiveMotion()).toBe(false);
        harness.frameHost.flushAll();
        expect(harness.world.style.transform).toBe(initialWorld);
        expect(harness.cursorHost.style.transform).toBe(initialCursor);
      } finally {
        harness.scheduler.teardown();
      }
    },
  );

  it.each(["camera", "cursor"] as const)(
    "shares the initial frame when only the %s was moving before overview focus",
    (initialMotion) => {
      const harness = createOverviewHarness();
      try {
        harness.scheduler.start();
        harness.store.setCameraModes(cameraModes("follow", "follow"));
        harness.store.setOverviewCardWidths(160, 160);
        harness.store.toggleOverviewMode();
        harness.frameHost.flushAll();
        if (initialMotion === "camera") {
          expect(harness.store.panOverviewBy(80, 0, viewport)).toBe(true);
          harness.frameHost.flushFrames(1);
        } else {
          harness.store.setCameraModes(cameraModes("follow", "fixed"));
          harness.frameHost.flushAll();
          expect(harness.store.focusPane("b")).toBe(true);
          harness.frameHost.flushFrames(4);
        }
        expect(harness.worldPresentation.hasActiveMotion()).toBe(
          initialMotion === "camera",
        );
        expect(harness.cursorPresentation.hasActiveMotion()).toBe(
          initialMotion === "cursor",
        );
        const worldBefore = harness.world.style.transform;
        const cursorBefore = harness.cursorHost.style.transform;
        if (initialMotion === "cursor") {
          harness.store.setCameraModes(cameraModes("follow", "follow"));
        }
        expect(harness.store.focusPane("c")).toBe(true);
        expect(harness.world.style.transform).toBe(worldBefore);
        expect(harness.cursorHost.style.transform).toBe(cursorBefore);
        harness.frameHost.flushFrames(1);
        expect(harness.world.style.transform).toBe(worldBefore);
        expect(harness.cursorHost.style.transform).toBe(cursorBefore);

        harness.frameHost.flushFrames(1);
        const advancedWorld = transformParts(harness.world.style.transform);
        const advancedCursor = transformParts(harness.cursorHost.style.transform);
        expect(harness.world.style.transform).not.toBe(worldBefore);
        expect(harness.cursorHost.style.transform).not.toBe(cursorBefore);
        harness.frameHost.flushAll();
        expect(
          fraction(
            advancedCursor.x,
            transformParts(cursorBefore).x,
            transformParts(harness.cursorHost.style.transform).x,
          ),
        ).toBeCloseTo(
          fraction(
            advancedWorld.x,
            transformParts(worldBefore).x,
            transformParts(harness.world.style.transform).x,
          ),
          3,
        );
        expect(harness.worldPresentation.hasActiveMotion()).toBe(false);
        expect(harness.cursorPresentation.hasActiveMotion()).toBe(false);
      } finally {
        harness.scheduler.teardown();
      }
    },
  );

  const renameCases = motionLayouts.flatMap((layout) =>
    (["normal", "overview"] as const).flatMap((mode) =>
      [0, 4].map((frames) => ({ layout, mode, frames })),
    ),
  );

  it.each(renameCases)(
    "keeps $layout.name $mode motion registered when renamed after $frames frames",
    ({ layout, mode, frames }) => {
      const control = createOverviewHarness(layout.scene());
      const renamed = createOverviewHarness(layout.scene());
      try {
        for (const harness of [control, renamed]) {
          startFocusMotion(harness, mode, layout.direction, frames);
        }
        const worldBeforeRename = renamed.world.style.transform;
        const cursorBeforeRename = renamed.cursorHost.style.transform;
        const revision = renamed.store.getSnapshot().layoutRevision;
        expect(renamed.frameHost.pendingFrameCount()).toBe(1);

        expect(renamed.store.renamePane("f", "Changed title")).toBe(true);
        expect(renamed.store.renamePane(layout.target, "Focused title")).toBe(
          true,
        );

        const snapshot = renamed.store.getSnapshot();
        const saved = serializeWorkspaceLayout(
          renamed.store.toScene(),
          snapshot.cursor,
        );
        expect(snapshot.layoutRevision).toBe(revision + 2);
        expect(snapshot.layoutChangeKind).toBe("user");
        expect(saved.panes.find((pane) => pane.paneId === "f")?.title).toBe(
          "Changed title",
        );
        expect(
          saved.panes.find((pane) => pane.paneId === layout.target)?.title,
        ).toBe("Focused title");
        expect(renamed.world.style.transform).toBe(worldBeforeRename);
        expect(renamed.cursorHost.style.transform).toBe(cursorBeforeRename);
        expectMatchingMotion(renamed, control);
        expect(renamed.store.getSnapshot().focusedPaneId).toBe(layout.target);
      } finally {
        control.scheduler.teardown();
        renamed.scheduler.teardown();
      }
    },
  );

  const resizeCases = motionLayouts.flatMap((layout) =>
    (["normal", "overview"] as const).flatMap((mode) =>
      ["resize then rename", "rename then resize"].map((order) => ({
        layout,
        mode,
        order,
      })),
    ),
  );

  it.each(resizeCases)(
    "applies coalesced $order during $layout.name $mode motion",
    ({ layout, mode, order }) => {
      const control = createOverviewHarness(layout.scene());
      const renamed = createOverviewHarness(layout.scene());
      try {
        for (const harness of [control, renamed]) {
          startFocusMotion(harness, mode, layout.direction, 4);
          expect(harness.cursorPresentation.hasActiveMotion()).toBe(true);
        }
        const notifications: { revision: number; title: string | undefined }[] =
          [];
        const revision = renamed.store.getSnapshot().layoutRevision;
        const unsubscribe = renamed.store.subscribe((snapshot) => {
          notifications.push({
            revision: snapshot.layoutRevision,
            title: serializeWorkspaceLayout(
              renamed.store.toScene(),
              snapshot.cursor,
            ).panes.find((pane) => pane.paneId === "f")?.title,
          });
        });
        const rename = () =>
          expect(renamed.store.renamePane("f", "Changed title")).toBe(true);
        if (order === "rename then resize") rename();
        for (const harness of [control, renamed]) {
          if (layout.direction === "right") {
            harness.store.resizeColumn(`column-${layout.target}`, {
              unit: "px",
              value: 487,
            });
          } else {
            expect(harness.store.resizePaneRow(layout.target, 376)).toBe(true);
          }
        }
        if (order === "resize then rename") rename();
        unsubscribe();

        expect(notifications).toEqual([
          {
            revision: revision + 1,
            title: order === "resize then rename" ? "F" : "Changed title",
          },
          { revision: revision + 2, title: "Changed title" },
        ]);
        expect(renamed.cursorPresentation.hasActiveMotion()).toBe(false);
        expectMatchingMotion(renamed, control);
        expect(renamed.store.getSnapshot().focusedPaneId).toBe(layout.target);
      } finally {
        control.scheduler.teardown();
        renamed.scheduler.teardown();
      }
    },
  );

  it("presents pane content, pane frames and the grid cursor from one camera state on every frame", () => {
    const harness = createOverviewHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("fixed", "follow"));
    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();

    const departingPanes = (
      ["right", "right", "right", "left"] as const
    ).reduce(
      (count, direction) => count + moveOverviewFocus(harness, direction),
      0,
    );
    expect(departingPanes).toBeGreaterThan(0);
    harness.scheduler.teardown();
  });
});
