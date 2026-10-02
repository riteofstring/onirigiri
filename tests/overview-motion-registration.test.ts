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
import { createWorkspaceScene } from "../src/workspace/workspace-scene";
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

function createOverviewHarness() {
  const { cursor, scene } = createWorkspaceScene({
    panes: paneIdsInRow.map((paneId, index) => ({
      columnId: `column-${paneId}`,
      columnWidth: { unit: "px" as const, value: 300 },
      paneId,
      slotIndex: index,
      surfaceKind: "test",
      title: paneId.toUpperCase(),
    })),
  });
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
