import type {
  LayoutFrameInput,
  WorkspaceColumn,
  WorkspaceScene,
} from "../types.js";

import {
  minimumColumnWidth,
  scrollOffsetForGridColumn,
  type ColumnGeometry,
  type GridRowGeometry,
} from "./layout-engine-helpers.js";

export function renderedColumnIndexesForLayout({
  columns,
  geometry,
  horizontalAnchorOffset = 0,
  planeGeometry,
  renderAllColumns,
  scene,
  inlinePadding = scene.padding,
  scrollColumn,
  verticalOffset,
  viewport,
}: {
  columns: readonly WorkspaceColumn[];
  geometry: ColumnGeometry;
  horizontalAnchorOffset?: number;
  inlinePadding?: number;
  planeGeometry: GridRowGeometry;
  renderAllColumns: boolean;
  scene: Pick<
    WorkspaceScene,
    "padding" | "renderOverscanColumns" | "visibleColumnCount"
  >;
  scrollColumn: number;
  verticalOffset: number;
  viewport: LayoutFrameInput["viewport"];
}): number[] {
  if (renderAllColumns) {
    return columns.map((column) => column.index);
  }
  const overscanColumns = Math.max(0, Math.floor(scene.renderOverscanColumns));
  const visiblePlaneIndexes = visiblePlaneIndexesForLayout(
    columns,
    planeGeometry,
    verticalOffset,
    viewport.height,
  );
  const horizontalPanOffset =
    scrollOffsetForGridColumn(scrollColumn, geometry) + horizontalAnchorOffset;
  if (overscanColumns === 0) {
    return renderedColumnIndexesWithoutOverscan({
      columns,
      geometry,
      scenePadding: inlinePadding,
      visibleColumnCountLimit: scene.visibleColumnCount,
      visiblePlaneIndexes,
      scrollOffset: horizontalPanOffset,
      viewportWidth: viewport.width,
    });
  }
  return renderedColumnIndexesWithOverscan({
    columns,
    geometry,
    scenePadding: inlinePadding,
    overscanColumns,
    scrollOffset: horizontalPanOffset,
    visiblePlaneIndexes,
    viewportWidth: viewport.width,
  });
}

export function columnsByIndexes(
  columns: readonly WorkspaceColumn[],
  indexes: readonly number[],
): WorkspaceColumn[] {
  const result: WorkspaceColumn[] = [];
  for (const index of indexes) {
    const column = columns[index];
    if (column) {
      result.push(column);
    }
  }
  return result;
}

function visiblePlaneIndexesForLayout(
  columns: readonly WorkspaceColumn[],
  planeGeometry: GridRowGeometry,
  verticalOffset: number,
  viewportHeight: number,
): number[] {
  const indexes = planeIndexes(columns);
  const visibleOrders = new Set<number>();
  for (let order = 0; order < indexes.length; order += 1) {
    const planeIndex = indexes[order];
    if (planeIndex === undefined) {
      continue;
    }
    const y = planeGeometry.gridOffsetForRow(planeIndex) - verticalOffset;
    const planeHeight = planeGeometry.gridHeightForRow(planeIndex);
    if (y + planeHeight < -2 * viewportHeight || y > 3 * viewportHeight) {
      continue;
    }
    visibleOrders.add(order);
  }
  if (visibleOrders.size === 0) {
    visibleOrders.add(0);
  }
  return [...visibleOrders]
    .sort((left, right) => left - right)
    .map((order) => indexes[order])
    .filter((planeIndex): planeIndex is number => planeIndex !== undefined);
}

function renderedColumnIndexesWithoutOverscan({
  columns,
  geometry,
  scenePadding,
  scrollOffset,
  visibleColumnCountLimit,
  visiblePlaneIndexes,
  viewportWidth,
}: {
  columns: readonly WorkspaceColumn[];
  geometry: ColumnGeometry;
  scenePadding: number;
  scrollOffset: number;
  visibleColumnCountLimit: number;
  visiblePlaneIndexes: readonly number[];
  viewportWidth: number;
}): number[] {
  const renderedColumnIndexes = new Set<number>();
  for (const planeIndex of visiblePlaneIndexes) {
    const planeColumns = columnsInPlane(columns, planeIndex);
    let addedColumnCount = 0;
    for (const column of planeColumns) {
      if (
        !columnIntersectsViewport(
          column,
          geometry,
          scenePadding,
          scrollOffset,
          viewportWidth,
        )
      ) {
        continue;
      }
      addColumnIndex(renderedColumnIndexes, column);
      addedColumnCount += 1;
      if (addedColumnCount >= visibleColumnCountLimit) {
        break;
      }
    }
    if (addedColumnCount > 0) {
      continue;
    }
    const fallbackColumnIndex = nearestPlaneColumnIndexForScrollOffset(
      planeColumns,
      geometry,
      scrollOffset,
    );
    for (
      let index = fallbackColumnIndex;
      index <
      Math.min(
        planeColumns.length,
        fallbackColumnIndex + visibleColumnCountLimit,
      );
      index += 1
    ) {
      addColumnIndex(renderedColumnIndexes, planeColumns[index]);
    }
  }
  return sortedColumnIndexes(renderedColumnIndexes);
}

function renderedColumnIndexesWithOverscan({
  columns,
  geometry,
  overscanColumns,
  scenePadding,
  scrollOffset,
  visiblePlaneIndexes,
  viewportWidth,
}: {
  columns: readonly WorkspaceColumn[];
  geometry: ColumnGeometry;
  overscanColumns: number;
  scenePadding: number;
  scrollOffset: number;
  visiblePlaneIndexes: readonly number[];
  viewportWidth: number;
}): number[] {
  const renderedColumnIndexes = new Set<number>();
  for (const planeIndex of visiblePlaneIndexes) {
    const planeColumns = columnsInPlane(columns, planeIndex);
    const range = visibleColumnRangeForPlane({
      geometry,
      planeColumns,
      scenePadding,
      scrollOffset,
      viewportWidth,
    });
    const firstRenderedColumn = Math.max(0, range.first - overscanColumns);
    const lastRenderedColumn = Math.min(
      planeColumns.length - 1,
      range.last + overscanColumns,
    );
    for (
      let index = firstRenderedColumn;
      index <= lastRenderedColumn;
      index += 1
    ) {
      addColumnIndex(renderedColumnIndexes, planeColumns[index]);
    }
    for (const column of planeColumns) {
      if (
        columnIntersectsRunway(
          column,
          geometry,
          scenePadding,
          scrollOffset,
          viewportWidth,
        )
      ) {
        addColumnIndex(renderedColumnIndexes, column);
      }
    }
  }
  return sortedColumnIndexes(renderedColumnIndexes);
}

function visibleColumnRangeForPlane({
  geometry,
  planeColumns,
  scenePadding,
  scrollOffset,
  viewportWidth,
}: {
  geometry: ColumnGeometry;
  planeColumns: readonly WorkspaceColumn[];
  scenePadding: number;
  scrollOffset: number;
  viewportWidth: number;
}): { first: number; last: number } {
  let first = planeColumns.length;
  let last = -1;
  for (
    let planeColumnIndex = 0;
    planeColumnIndex < planeColumns.length;
    planeColumnIndex += 1
  ) {
    const column = planeColumns[planeColumnIndex];
    if (
      column &&
      columnIntersectsViewport(
        column,
        geometry,
        scenePadding,
        scrollOffset,
        viewportWidth,
      )
    ) {
      first = Math.min(first, planeColumnIndex);
      last = Math.max(last, planeColumnIndex);
    }
  }
  if (last >= 0) {
    return { first, last };
  }
  const fallbackColumn = nearestPlaneColumnIndexForScrollOffset(
    planeColumns,
    geometry,
    scrollOffset,
  );
  return { first: fallbackColumn, last: fallbackColumn };
}

function columnIntersectsViewport(
  column: WorkspaceColumn,
  geometry: ColumnGeometry,
  scenePadding: number,
  scrollOffset: number,
  viewportWidth: number,
): boolean {
  const columnWidth = geometry.widths[column.index] ?? minimumColumnWidth;
  const x = scenePadding + (geometry.offsets[column.index] ?? 0) - scrollOffset;
  return x + columnWidth >= 0 && x <= viewportWidth;
}

function columnIntersectsRunway(
  column: WorkspaceColumn,
  geometry: ColumnGeometry,
  scenePadding: number,
  scrollOffset: number,
  viewportWidth: number,
): boolean {
  const columnWidth = geometry.widths[column.index] ?? minimumColumnWidth;
  const x = scenePadding + (geometry.offsets[column.index] ?? 0) - scrollOffset;
  return x + columnWidth >= -2 * viewportWidth && x <= 3 * viewportWidth;
}

function columnsInPlane(
  columns: readonly WorkspaceColumn[],
  planeIndex: number,
): WorkspaceColumn[] {
  return columns.filter((column) => column.planeIndex === planeIndex);
}

function nearestPlaneColumnIndexForScrollOffset(
  planeColumns: readonly WorkspaceColumn[],
  geometry: ColumnGeometry,
  scrollOffset: number,
): number {
  let nearestColumnIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < planeColumns.length; index += 1) {
    const column = planeColumns[index];
    if (!column) {
      continue;
    }
    const distance = Math.abs(
      (geometry.offsets[column.index] ?? 0) - scrollOffset,
    );
    if (distance < nearestDistance) {
      nearestColumnIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestColumnIndex;
}

function planeIndexes(columns: readonly WorkspaceColumn[]): number[] {
  return [...new Set(columns.map((column) => column.planeIndex))].sort(
    (left, right) => left - right,
  );
}

function addColumnIndex(
  target: Set<number>,
  column: WorkspaceColumn | undefined,
): void {
  if (column) {
    target.add(column.index);
  }
}

function sortedColumnIndexes(indexes: ReadonlySet<number>): number[] {
  return [...indexes].sort((left, right) => left - right);
}
