import { expect, vi } from "vitest";

import type { AnimationFrameHost } from "../src/presentation/animation-clock";
import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import { PanePresentationEngine } from "../src/presentation/pane-presentation-engine";
import {
  WorkspaceFrameScheduler,
  type WorkspaceFrameMotionOptions,
} from "../src/presentation/workspace-frame-scheduler";
import { WorkspaceGridCursorPresentation } from "../src/workspace/workspace-grid-cursor-presentation";
import { WorkspaceWorldPresentation } from "../src/presentation/workspace-world-presentation";
import {
  workspaceGridCursorRenderItem,
  workspaceWorldRenderFrame,
} from "../src/presentation/workspace-render-items";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
} from "../src/workspace/workspace-scene";
import type {
  Rect,
  WorkspaceCameraMode,
  WorkspaceCameraModes,
  WorkspaceGridCursor,
  WorkspaceScene,
} from "../src/types";
import { workspaceGridCursorForPane } from "../src/workspace/workspace-grid-cursor";

export const viewport = { height: 600, width: 360, x: 0, y: 0 };

export class ManualAnimationFrameHost implements AnimationFrameHost {
  private callbacks = new Map<number, FrameRequestCallback>();
  private nextId = 1;
  private timestamp = 0;

  cancelAnimationFrame(frameId: number): void {
    this.callbacks.delete(frameId);
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const frameId = this.nextId;
    this.nextId += 1;
    this.callbacks.set(frameId, callback);
    return frameId;
  }

  flushAll(): void {
    for (let index = 0; index < 1_000 && this.callbacks.size > 0; index += 1) {
      this.timestamp += 1000 / 120;
      this.flushOne(this.timestamp);
    }
    if (this.callbacks.size > 0) {
      throw new Error("animation clock did not settle within 1000 frames");
    }
  }

  flushFrames(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.timestamp += 1000 / 120;
      this.flushOne(this.timestamp);
    }
  }

  flushOne(timestamp: number): void {
    const first = this.callbacks.entries().next().value as
      [number, FrameRequestCallback] | undefined;
    if (!first) {
      throw new Error("no animation frame was requested");
    }
    this.callbacks.delete(first[0]);
    first[1](timestamp);
  }

  pendingFrameCount(): number {
    return this.callbacks.size;
  }
}

export function createSchedulerHarness(
  reducedMotionQuery?: MediaQueryList,
  cursorPresentation?: WorkspaceGridCursorPresentation,
  worldPresentation?: WorkspaceWorldPresentation,
  motion?: WorkspaceFrameMotionOptions,
) {
  const { cursor, scene } = createWorkspaceScene({
    panes: ["a", "b", "c"].map((paneId, index) => ({
      columnId: `column-${paneId}`,
      columnWidth: { unit: "px" as const, value: 300 },
      paneId,
      slotIndex: index,
      surfaceKind: "test",
      title: paneId.toUpperCase(),
    })),
  });
  return createSchedulerHarnessFor(
    scene,
    cursor,
    ["a", "b", "c"],
    reducedMotionQuery,
    cursorPresentation,
    worldPresentation,
    motion,
  );
}

export function createSchedulerHarnessFor(
  scene: WorkspaceScene,
  cursor: WorkspaceGridCursor,
  paneIds: readonly string[],
  reducedMotionQuery?: MediaQueryList,
  cursorPresentation?: WorkspaceGridCursorPresentation,
  providedWorldPresentation?: WorkspaceWorldPresentation,
  motion?: WorkspaceFrameMotionOptions,
) {
  const engine = new WorkspaceLikeLayoutEngine(scene);
  const store = schedulerTestStore(engine, scene, cursor);
  store.ensureFocusedPaneVisible(viewport);
  const presentation = new PanePresentationEngine();
  const stage = document.createElement("div");
  const worldGrid = document.createElement("div");
  const worldPresentation =
    providedWorldPresentation ?? new WorkspaceWorldPresentation();
  if (!providedWorldPresentation) {
    worldPresentation.bindWorldHost(stage, worldGrid);
  }
  const frameHost = new ManualAnimationFrameHost();
  const boundaries = vi.fn();
  const samples: number[] = [];
  const hosts = new Map<string, HTMLElement>();
  for (const paneId of paneIds) {
    const host = document.createElement("section");
    hosts.set(paneId, host);
    presentation.registerPaneHost(paneId, host);
  }
  const scheduler = new WorkspaceFrameScheduler({
    compactLayoutProvider: () => false,
    engine,
    frameHost,
    onBoundary: boundaries,
    onFrame: () => samples.push(store.getSnapshot().scrollColumn),
    cursorPresentation,
    motionProvider: motion ? () => motion : undefined,
    presentation,
    reducedMotionQuery,
    store,
    viewportProvider: () => viewport,
    worldPresentation,
  });
  return {
    boundaries,
    engine,
    frameHost,
    hosts,
    presentation,
    samples,
    scheduler,
    stage,
    store,
    worldGrid,
    worldPresentation,
  };
}

export function createTwoDimensionalSchedulerHarness(
  reducedMotionQuery?: MediaQueryList,
  harnessViewport: Rect = viewport,
) {
  const { cursor, scene } = createWorkspaceScene({
    panes: [
      {
        columnId: "source-column",
        columnWidth: { unit: "px" as const, value: 300 },
        paneId: "source",
        planeIndex: 0,
        slotIndex: 0,
        surfaceKind: "test",
        title: "Source",
      },
      {
        columnId: "right-column",
        columnWidth: { unit: "px" as const, value: 300 },
        paneId: "right",
        planeIndex: 0,
        slotIndex: 1,
        surfaceKind: "test",
        title: "Right",
      },
      {
        columnId: "lower-column",
        columnWidth: { unit: "px" as const, value: 300 },
        paneId: "lower",
        planeIndex: 1,
        slotIndex: 0,
        surfaceKind: "test",
        title: "Lower",
      },
    ],
  });
  const engine = new WorkspaceLikeLayoutEngine(scene);
  const store = schedulerTestStore(engine, scene, cursor);
  store.ensureFocusedPaneVisible(harnessViewport);
  const presentation = new PanePresentationEngine();
  const stage = document.createElement("div");
  const worldGrid = document.createElement("div");
  const worldPresentation = new WorkspaceWorldPresentation();
  worldPresentation.bindWorldHost(stage, worldGrid);
  const frameHost = new ManualAnimationFrameHost();
  const boundaries = vi.fn();
  const samples: number[] = [];
  const hosts = new Map<string, HTMLElement>();
  for (const paneId of ["source", "right", "lower"]) {
    const host = document.createElement("section");
    hosts.set(paneId, host);
    presentation.registerPaneHost(paneId, host);
  }
  const scheduler = new WorkspaceFrameScheduler({
    compactLayoutProvider: () => false,
    engine,
    frameHost,
    onBoundary: boundaries,
    onFrame: () => samples.push(store.getSnapshot().scrollColumn),
    presentation,
    reducedMotionQuery,
    store,
    viewportProvider: () => harnessViewport,
    worldPresentation,
  });
  return {
    boundaries,
    engine,
    frameHost,
    hosts,
    presentation,
    samples,
    scheduler,
    stage,
    store,
    worldGrid,
    worldPresentation,
  };
}

export function createVerticalEmptyCellSchedulerHarness() {
  const source = createWorkspaceScene({
    panes: [
      {
        columnId: "target-stack",
        columnWidth: { unit: "px" as const, value: 300 },
        heightPx: 180,
        paneId: "target",
        planeIndex: 1,
        slotIndex: 0,
        surfaceKind: "test",
        title: "Target",
        weight: 2,
      },
      {
        columnId: "source-stack",
        columnWidth: { unit: "px" as const, value: 300 },
        heightPx: 220,
        paneId: "top",
        planeIndex: 0,
        slotIndex: 0,
        surfaceKind: "test",
        title: "Top",
        weight: 3,
      },
      {
        columnId: "source-stack",
        columnWidth: { unit: "px" as const, value: 300 },
        heightPx: 300,
        paneId: "source",
        planeIndex: 0,
        slotIndex: 0,
        surfaceKind: "test",
        title: "Source",
        weight: 4,
      },
    ],
  });
  const layout = serializeWorkspaceLayout(
    source.scene,
    cursorForPane(source.scene, "source"),
  );
  const targetStack = layout.columns.find(
    (column) => column.columnId === "target-stack",
  );
  if (!targetStack) {
    throw new Error("expected target stack");
  }
  targetStack.cells = cellsFor(
    [null, "target"],
    [
      { heightPx: 320, weight: 1 },
      { heightPx: 180, weight: 2 },
    ],
    [true, false],
  );
  const restored = createWorkspaceScene({ initialLayout: layout });
  return createSchedulerHarnessFor(restored.scene, restored.cursor, [
    "target",
    "top",
    "source",
  ]);
}

export function cameraModes(
  normal: WorkspaceCameraMode,
  overview: WorkspaceCameraMode,
): WorkspaceCameraModes {
  return { normal, overview };
}

export function schedulerTestStore(
  engine: WorkspaceLikeLayoutEngine,
  scene: WorkspaceScene,
  cursor: WorkspaceGridCursor,
): WorkspaceLayoutStore {
  return new WorkspaceLayoutStore(engine, scene, cursor, {
    initialCameraModes: cameraModes("fixed", "fixed"),
    initialFocusAnchor: "start",
  });
}

export function overviewCursorFrame(
  engine: WorkspaceLikeLayoutEngine,
  snapshot: ReturnType<WorkspaceLayoutStore["getSnapshot"]>,
) {
  const input = {
    compactLayout: false,
    engine,
    moving: false,
    snapshot,
    viewport,
  };
  const cursor = workspaceGridCursorRenderItem(input);
  const worldFrame = workspaceWorldRenderFrame(input);
  return {
    ...cursor,
    scale: cursor.scale * worldFrame.scale,
    x: worldFrame.x + worldFrame.scale * cursor.x,
    y: worldFrame.y + worldFrame.scale * cursor.y,
  };
}

export function expectOverviewCursorCentered(
  cursor: ReturnType<typeof overviewCursorFrame>,
): void {
  expect(cursor.x + (cursor.width * cursor.scale) / 2).toBeCloseTo(
    viewport.x + viewport.width / 2,
    3,
  );
  expect(cursor.y + (cursor.height * cursor.scale) / 2).toBeCloseTo(
    viewport.y + viewport.height / 2,
    3,
  );
}

export function requiredHost(
  hosts: ReadonlyMap<string, HTMLElement>,
  paneId: string,
): HTMLElement {
  const host = hosts.get(paneId);
  if (!host) {
    throw new Error(`missing stable pane host ${paneId}`);
  }
  return host;
}

export function cursorForPane(
  scene: WorkspaceScene,
  paneId: string,
): WorkspaceGridCursor {
  const cursor = workspaceGridCursorForPane(scene, paneId);
  if (!cursor) {
    throw new Error(`missing pane ${paneId}`);
  }
  return cursor;
}

export function transformScale(transform: string): string {
  const match = /scale\(([^,)]+)/.exec(transform);
  if (!match?.[1]) {
    throw new Error(`missing scale in pane transform: ${transform}`);
  }
  return match[1];
}

export function transformScaleValue(transform: string): number {
  return Number(transformScale(transform));
}

function transformScaleYValue(transform: string): number {
  const match = /scale\(([^,)]+)(?:, ([^,)]+))?\)/.exec(transform);
  if (!match?.[1]) {
    throw new Error(`missing scale in pane transform: ${transform}`);
  }
  return Number(match[2] ?? match[1]);
}

export function displayedPosition(
  host: HTMLElement,
  stage: HTMLElement,
): [number, number] {
  const [paneX, paneY] = transformCoordinates(host.style.transform);
  const [worldX, worldY] = transformCoordinates(stage.style.transform);
  const worldScale = transformScaleValue(stage.style.transform);
  return [worldX + worldScale * paneX, worldY + worldScale * paneY];
}

interface VisualPaneBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

export function expectVisualPaneBox(
  host: HTMLElement,
  stage: HTMLElement,
  expected: VisualPaneBox,
): void {
  const actual = visualPaneBox(host, stage);
  expect(actual.height).toBeCloseTo(expected.height, 1);
  expect(actual.width).toBeCloseTo(expected.width, 1);
  expect(actual.x).toBeCloseTo(expected.x, 2);
  expect(actual.y).toBeCloseTo(expected.y, 2);
}

export function visualPaneBox(
  host: HTMLElement,
  stage: HTMLElement,
): VisualPaneBox {
  const [x, y] = displayedPosition(host, stage);
  const scaleX = transformScaleValue(host.style.transform);
  const scaleY = transformScaleYValue(host.style.transform);
  const worldScale = transformScaleValue(stage.style.transform);
  return {
    height: Number.parseFloat(host.style.height) * scaleY * worldScale,
    width: Number.parseFloat(host.style.width) * scaleX * worldScale,
    x,
    y,
  };
}

export function visualWorldPaneBox(
  host: HTMLElement,
  world: HTMLElement,
): VisualPaneBox {
  const [paneX, paneY] = transformCoordinates(host.style.transform);
  const paneScale = transformScaleValue(host.style.transform);
  const [worldX, worldY] = transformCoordinates(world.style.transform);
  const worldScale = transformScaleValue(world.style.transform);
  return {
    height: Number.parseFloat(host.style.height) * paneScale * worldScale,
    width: Number.parseFloat(host.style.width) * paneScale * worldScale,
    x: worldX + worldScale * paneX,
    y: worldY + worldScale * paneY,
  };
}

export function expectVisualWorldPaneBox(
  host: HTMLElement,
  world: HTMLElement,
  expected: VisualPaneBox,
): void {
  const actual = visualWorldPaneBox(host, world);
  expect(actual.height).toBeCloseTo(expected.height, 1);
  expect(actual.width).toBeCloseTo(expected.width, 1);
  expect(actual.x).toBeCloseTo(expected.x, 2);
  expect(actual.y).toBeCloseTo(expected.y, 2);
}

export function rowSizingSnapshot(scene: WorkspaceScene) {
  return scene.columns.map((column) => ({
    columnId: column.columnId,
    rowSizing: column.cells.map(({ heightPx, weight }) =>
      heightPx === undefined ? { weight } : { heightPx, weight },
    ),
  }));
}

export function paneIds(
  column: WorkspaceScene["columns"][number] | undefined,
): Array<string | null> | undefined {
  return column?.cells.map((cell) => cell.paneId);
}

function cellsFor(
  paneIds: readonly (string | null)[],
  sizing: readonly { heightPx?: number; weight: number }[],
  reserved: readonly boolean[] = [],
) {
  return paneIds.map((paneId, index) => ({
    ...(sizing[index]?.heightPx === undefined
      ? {}
      : { heightPx: sizing[index]?.heightPx }),
    paneId,
    reserved: reserved[index] ?? false,
    weight: sizing[index]?.weight ?? 1,
  }));
}

export function expectDisplayedPosition(
  host: HTMLElement,
  stage: HTMLElement,
  expected: [number, number],
): void {
  const [x, y] = displayedPosition(host, stage);
  expect(x).toBeCloseTo(expected[0], 2);
  expect(y).toBeCloseTo(expected[1], 2);
}

function transformCoordinates(transform: string): [number, number] {
  const match = /translate(?:3d)?\((-?[\d.]+)px, (-?[\d.]+)px/.exec(transform);
  if (!match?.[1] || !match[2]) {
    throw new Error(`missing transform coordinates: ${transform}`);
  }
  return [Number(match[1]), Number(match[2])];
}

export function expectIntermediateMonotonicTrajectory(
  samples: readonly number[],
  start: number,
  end: number,
): void {
  expect(samples.some((value) => value > start && value < end)).toBe(true);
  expect(
    samples.every(
      (value, index) => index === 0 || value >= (samples[index - 1] ?? start),
    ),
  ).toBe(true);
}
