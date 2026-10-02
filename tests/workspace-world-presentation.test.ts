import { describe, expect, it } from "vitest";

import type { WorkspaceWorldFrame } from "../src/types";
import { WorkspaceWorldPresentation } from "../src/presentation/workspace-world-presentation";

describe("WorkspaceWorldPresentation", () => {
  it("keeps a pane and the dotted grid registered through normal, overview, and reversal frames", () => {
    const presenter = new WorkspaceWorldPresentation();
    const world = document.createElement("div");
    const grid = document.createElement("div");
    const pane = document.createElement("section");
    pane.style.transform = "translate3d(960px, 180px, 0) scale(1)";
    world.append(grid, pane);
    presenter.bindWorldHost(world, grid);

    const normal = worldFrame({ scale: 1, x: -320, y: -48 });
    const overview = worldFrame({ scale: 0.45, x: 214, y: 92 });
    presenter.apply(normal);
    const normalPanePosition = projectedPoint(world, pane);
    expect(grid.parentElement).toBe(world);
    expect(pane.parentElement).toBe(world);

    expect(presenter.retarget(normal, overview)).toBe(true);
    expect(projectedPoint(world, pane)).toEqual(normalPanePosition);
    presenter.advanceMotion(40);
    presenter.apply(overview, true);
    const duringOverview = projectedPoint(world, pane);
    expect(duringOverview[0]).toBeGreaterThan(normalPanePosition[0]);
    expect(duringOverview[0]).toBeLessThan(
      projectedPointFor(overview, pane)[0],
    );

    expect(presenter.retarget(overview, normal)).toBe(true);
    expect(projectedPoint(world, pane)).toEqual(duringOverview);
    presenter.advanceMotion(160);
    presenter.apply(normal);
    expect(projectedPoint(world, pane)).toEqual(normalPanePosition);
    expect(presenter.hasActiveMotion()).toBe(false);
  });

  it("moves the destination focal point on one direct monotonic screen path", () => {
    const presenter = new WorkspaceWorldPresentation();
    const world = document.createElement("div");
    const grid = document.createElement("div");
    world.append(grid);
    presenter.bindWorldHost(world, grid);

    const source = worldFrame({
      focalScreenX: 260,
      focalScreenY: 180,
      focalWorldX: 900,
      focalWorldY: 420,
      scale: 1,
      x: -640,
      y: -240,
    });
    const destination = worldFrame({
      focalScreenX: 800,
      focalScreenY: 450,
      focalWorldX: 1_320,
      focalWorldY: 760,
      scale: 0.42,
      x: 245.6,
      y: 130.8,
    });
    presenter.apply(source);
    expect(presenter.retarget(source, destination)).toBe(true);

    const points = [projectedFocalPoint(world, destination)];
    for (const delta of [11.5, 17.25, 28.75, 34.5, 23]) {
      presenter.advanceMotion(delta);
      presenter.apply(destination, true);
      points.push(projectedFocalPoint(world, destination));
    }

    expect(points.at(0)).toEqual([
      source.x + source.scale * destination.focalWorldX,
      source.y + source.scale * destination.focalWorldY,
    ]);
    expect(points.at(-1)).toEqual([
      destination.focalScreenX,
      destination.focalScreenY,
    ]);
    expectDirectMonotonicPath(points);
  });

  it("keeps the dot phase pinned to world zero when its bounded paint surface recenters", () => {
    const presenter = new WorkspaceWorldPresentation();
    const world = document.createElement("div");
    const grid = document.createElement("div");
    world.append(grid);
    presenter.bindWorldHost(world, grid);

    presenter.apply(worldFrame({ scale: 1, x: 0, y: 0 }));
    const firstOrigin = gridPatternOrigin(grid);
    presenter.apply(worldFrame({ scale: 1, x: -3_600, y: -2_100 }));
    const secondOrigin = gridPatternOrigin(grid);

    expect(firstOrigin).toEqual([0, 0]);
    expect(secondOrigin).toEqual([0, 0]);
  });

  it("bounds the shared grid paint surface while covering a complete camera sweep", () => {
    const presenter = new WorkspaceWorldPresentation();
    const world = document.createElement("div");
    const grid = document.createElement("div");
    const pane = document.createElement("section");
    const cursor = document.createElement("div");
    world.append(grid, pane, cursor);
    presenter.bindWorldHost(world, grid);

    const source = worldFrame({ scale: 1, x: 0, y: 0 });
    const destination = worldFrame({ scale: 1, x: -2_400, y: -900 });
    presenter.apply(source);
    const settledSourceGrid = gridPaintRect(grid);

    expect(settledSourceGrid.width).toBeCloseTo(testViewport.width * 1.5, 1);
    expect(settledSourceGrid.height).toBeCloseTo(testViewport.height * 1.5, 1);
    expect(grid.parentElement).toBe(world);
    expect(pane.parentElement).toBe(world);
    expect(cursor.parentElement).toBe(world);

    expect(presenter.retarget(source, destination)).toBe(true);
    const sweepGrid = gridPaintRect(grid);
    expectRectContains(sweepGrid, source.grid);
    expectRectContains(sweepGrid, destination.grid);

    presenter.advanceMotion(160);
    presenter.apply(destination);
    const settledDestinationGrid = gridPaintRect(grid);
    expect(settledDestinationGrid.width).toBeCloseTo(
      testViewport.width * 1.5,
      1,
    );
    expect(settledDestinationGrid.height).toBeCloseTo(
      testViewport.height * 1.5,
      1,
    );
    expect(sweepGrid.width).toBeGreaterThan(settledDestinationGrid.width);
    expect(sweepGrid.height).toBeGreaterThan(settledDestinationGrid.height);
  });
});

const testViewport = { height: 900, width: 1_600, x: 0, y: 0 };

function worldFrame({
  focalScreenX,
  focalScreenY,
  focalWorldX,
  focalWorldY,
  scale,
  x,
  y,
}: Pick<WorkspaceWorldFrame, "scale" | "x" | "y"> &
  Partial<
    Pick<
      WorkspaceWorldFrame,
      "focalScreenX" | "focalScreenY" | "focalWorldX" | "focalWorldY"
    >
  >): WorkspaceWorldFrame {
  const left = (testViewport.x - x) / scale;
  const top = (testViewport.y - y) / scale;
  const resolvedFocalWorldX =
    focalWorldX ?? left + testViewport.width / scale / 2;
  const resolvedFocalWorldY =
    focalWorldY ?? top + testViewport.height / scale / 2;
  return {
    focalScreenX: focalScreenX ?? x + resolvedFocalWorldX * scale,
    focalScreenY: focalScreenY ?? y + resolvedFocalWorldY * scale,
    focalWorldX: resolvedFocalWorldX,
    focalWorldY: resolvedFocalWorldY,
    grid: {
      height: testViewport.height / scale,
      width: testViewport.width / scale,
      x: left,
      y: top,
    },
    scale,
    x,
    y,
  };
}

function projectedFocalPoint(
  world: HTMLElement,
  frame: WorkspaceWorldFrame,
): [number, number] {
  const [x, y] = transformCoordinates(world.style.transform);
  const scale = transformScale(world.style.transform);
  return [
    Number((x + scale * frame.focalWorldX).toFixed(2)),
    Number((y + scale * frame.focalWorldY).toFixed(2)),
  ];
}

function expectDirectMonotonicPath(points: readonly [number, number][]): void {
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) {
    throw new Error("missing camera path endpoints");
  }
  let previousProgress = -1;
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  for (const point of points) {
    const offsetX = point[0] - start[0];
    const offsetY = point[1] - start[1];
    const progress = (offsetX * deltaX + offsetY * deltaY) / lengthSquared;
    const orthogonalError =
      Math.abs(offsetX * deltaY - offsetY * deltaX) / Math.sqrt(lengthSquared);
    expect(progress).toBeGreaterThanOrEqual(previousProgress - 0.0001);
    expect(orthogonalError).toBeLessThan(0.1);
    previousProgress = progress;
  }
}

function gridPaintRect(grid: HTMLElement) {
  return {
    height: Number.parseFloat(grid.style.height),
    width: Number.parseFloat(grid.style.width),
    x: Number.parseFloat(grid.style.left),
    y: Number.parseFloat(grid.style.top),
  };
}

function expectRectContains(
  container: ReturnType<typeof gridPaintRect>,
  contained: WorkspaceWorldFrame["grid"],
): void {
  expect(container.x).toBeLessThanOrEqual(contained.x);
  expect(container.y).toBeLessThanOrEqual(contained.y);
  expect(container.x + container.width).toBeGreaterThanOrEqual(
    contained.x + contained.width,
  );
  expect(container.y + container.height).toBeGreaterThanOrEqual(
    contained.y + contained.height,
  );
}

function projectedPoint(
  world: HTMLElement,
  pane: HTMLElement,
): [number, number] {
  const [worldX, worldY] = transformCoordinates(world.style.transform);
  const worldScale = transformScale(world.style.transform);
  const [paneX, paneY] = transformCoordinates(pane.style.transform);
  return [worldX + worldScale * paneX, worldY + worldScale * paneY];
}

function projectedPointFor(
  frame: WorkspaceWorldFrame,
  pane: HTMLElement,
): [number, number] {
  const [paneX, paneY] = transformCoordinates(pane.style.transform);
  return [frame.x + frame.scale * paneX, frame.y + frame.scale * paneY];
}

function gridPatternOrigin(grid: HTMLElement): [number, number] {
  const left = Number.parseFloat(grid.style.left);
  const top = Number.parseFloat(grid.style.top);
  const phaseX = Number.parseFloat(
    grid.style.getPropertyValue("--world-grid-phase-x"),
  );
  const phaseY = Number.parseFloat(
    grid.style.getPropertyValue("--world-grid-phase-y"),
  );
  return [left + phaseX, top + phaseY];
}

function transformCoordinates(transform: string): [number, number] {
  const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(transform);
  if (!match?.[1] || !match[2]) {
    throw new Error(`missing transform coordinates: ${transform}`);
  }
  return [Number(match[1]), Number(match[2])];
}

function transformScale(transform: string): number {
  const match = /scale\((-?[\d.]+)\)/.exec(transform);
  if (!match?.[1]) {
    throw new Error(`missing transform scale: ${transform}`);
  }
  return Number(match[1]);
}
