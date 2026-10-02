import {
  constrainPaneDimension,
  preferredPaneHeight,
  resolvePaneDefaults,
} from "./pane-defaults.js";
import type {
  ColumnWidthSpec,
  LayoutFrameInput,
  PaneCellSizing,
  PaneId,
  PaneSizingConfiguration,
  PaneRenderItem,
  ReservedCellRenderItem,
  WorkspaceColumn,
  WorkspacePane,
  WorkspaceScene,
} from "../types.js";

interface PaneGridSizing {
  configuration: PaneSizingConfiguration;
  widthForColumn: (column: WorkspaceColumn) => number;
}

interface PaneColumnSizing {
  configuration: PaneSizingConfiguration;
  columnWidth: number;
}

interface PaneCellLayout extends PaneCellSizing {
  pane: WorkspacePane | null;
  paneId: PaneId | null;
  reserved: boolean;
}

export type PaneDirection = "up" | "down" | "left" | "right";
export type PaneLocation = {
  columnIndex: number;
  planeColumnIndex: number;
  planeIndex: number;
  rowIndex: number;
};
export type ColumnGeometry = {
  gridMaxColumn: number;
  gridMinColumn: number;
  gridOffsetForColumn: (column: number) => number;
  gridWidthForColumn: (column: number) => number;
  offsets: number[];
  widths: number[];
};
export type GridColumnRange = {
  maxColumn: number;
  minColumn: number;
  originColumn: number;
};
export type GridRowGeometry = {
  gridMaxRow: number;
  gridMinRow: number;
  gridHeightForRow: (row: number) => number;
  gridOffsetForRow: (row: number) => number;
  totalHeight: number;
};
export type GridRowRange = {
  maxRow: number;
  minRow: number;
  originRow: number;
};
type PlaneGeometry = {
  heights: ReadonlyMap<number, number>;
  offsets: ReadonlyMap<number, number>;
  totalHeight: number;
};

export const minimumColumnWidth = 96;

export {
  applyOverviewZoom,
  OVERVIEW_MAX_ZOOM_SCALE,
  OVERVIEW_MIN_ZOOM,
  overviewScale,
  type OverviewCardSizeConstraints,
} from "./overview-scale.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isHorizontalDirection(
  direction: PaneDirection,
): direction is "left" | "right" {
  return direction === "left" || direction === "right";
}

export function nextNumericSuffix<T>(
  items: readonly T[],
  prefix: string,
  idForItem: (item: T) => string,
): number {
  let next = 0;
  for (const item of items) {
    const id = idForItem(item);
    if (!id.startsWith(prefix)) {
      continue;
    }
    const parsed = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isInteger(parsed)) {
      next = Math.max(next, parsed + 1);
    }
  }
  return next;
}

export function normalizedColumnWidthSpec(
  spec: ColumnWidthSpec,
): ColumnWidthSpec {
  if (spec.unit === "px") {
    return { unit: "px", value: Math.max(minimumColumnWidth, spec.value) };
  }
  return { unit: "proportion", value: clamp(spec.value, 0.1, 1) };
}

function planeGeometryForLayout({
  availableHeight,
  columns,
  fullSizePanes = false,
  maximizedPaneId = null,
  padding,
  paneById,
  planeGap,
  planeIndexes: indexes,
  rowGap,
  viewportHeight,
  sizing,
}: {
  availableHeight: number;
  columns: readonly WorkspaceColumn[];
  fullSizePanes?: boolean;
  maximizedPaneId?: PaneId | null;
  padding: number;
  paneById: Map<PaneId, WorkspacePane>;
  planeGap: number;
  planeIndexes: readonly number[];
  rowGap: number;
  viewportHeight: number;
  sizing?: PaneGridSizing;
}): PlaneGeometry {
  const heights = new Map<number, number>();
  const offsets = new Map<number, number>();
  const planeColumns = new Map<number, WorkspaceColumn[]>();
  for (const column of columns) {
    const members = planeColumns.get(column.planeIndex);
    if (members) members.push(column);
    else planeColumns.set(column.planeIndex, [column]);
  }
  let offset = 0;
  for (const planeIndex of indexes) {
    const height = planeOuterHeightForLayout({
      availableHeight,
      columns: planeColumns.get(planeIndex) ?? [],
      fullSizePanes,
      maximizedPaneId,
      padding,
      paneById,
      rowGap,
      viewportHeight,
      sizing,
    });
    heights.set(planeIndex, height);
    offsets.set(planeIndex, offset);
    offset += height + planeGap - padding * 2;
  }
  return {
    heights,
    offsets,
    totalHeight:
      indexes.length === 0
        ? Math.max(1, viewportHeight)
        : offset - planeGap + padding * 2,
  };
}

export function gridColumnGeometryForLayout({
  columnGap,
  defaultWidth,
  range,
  slotWidths,
}: {
  columnGap: number;
  defaultWidth: number;
  range: GridColumnRange;
  slotWidths: ReadonlyMap<number, number>;
}): Pick<
  ColumnGeometry,
  | "gridMaxColumn"
  | "gridMinColumn"
  | "gridOffsetForColumn"
  | "gridWidthForColumn"
> {
  const gridMinColumn = Math.min(range.minColumn, ...slotWidths.keys());
  const gridMaxColumn = Math.max(range.maxColumn, ...slotWidths.keys());
  const coordinateGeometry = sparseGridCoordinateGeometry({
    defaultValue: defaultWidth,
    originCoordinate: range.originColumn,
    overrides: slotWidths,
    stepGap: columnGap,
  });
  return {
    gridMaxColumn,
    gridMinColumn,
    gridOffsetForColumn: coordinateGeometry.offsetForCoordinate,
    gridWidthForColumn: coordinateGeometry.valueForCoordinate,
  };
}

export function originGridColumnRange(): GridColumnRange {
  return {
    maxColumn: 0,
    minColumn: 0,
    originColumn: 0,
  };
}

export function gridColumnRangeAt(originColumn: number): GridColumnRange {
  return {
    maxColumn: originColumn,
    minColumn: originColumn,
    originColumn,
  };
}

export function gridRowGeometryForLayout({
  availableHeight,
  columns,
  fullSizePanes = false,
  gridRange,
  maximizedPaneId = null,
  padding,
  paneById,
  planeGap,
  rowGap,
  viewportHeight,
  sizing,
}: {
  availableHeight: number;
  columns: readonly WorkspaceColumn[];
  fullSizePanes?: boolean;
  gridRange: GridRowRange;
  maximizedPaneId?: PaneId | null;
  padding: number;
  paneById: Map<PaneId, WorkspacePane>;
  planeGap: number;
  rowGap: number;
  viewportHeight: number;
  sizing?: PaneGridSizing;
}): GridRowGeometry {
  const structuralRows = [
    ...new Set(columns.map((column) => column.planeIndex)),
  ].toSorted((left, right) => left - right);
  const structuralGeometry = planeGeometryForLayout({
    availableHeight,
    columns,
    fullSizePanes,
    maximizedPaneId,
    padding,
    paneById,
    planeGap,
    planeIndexes: structuralRows,
    rowGap,
    viewportHeight,
    sizing,
  });
  const gridMinRow = Math.min(gridRange.minRow, ...structuralRows);
  const gridMaxRow = Math.max(gridRange.maxRow, ...structuralRows);
  const coordinateGeometry = sparseGridCoordinateGeometry({
    defaultValue: viewportHeight,
    originCoordinate: gridRange.originRow,
    overrides: structuralGeometry.heights,
    stepGap: planeGap - padding * 2,
  });
  return {
    gridMaxRow,
    gridMinRow,
    gridHeightForRow: coordinateGeometry.valueForCoordinate,
    gridOffsetForRow: coordinateGeometry.offsetForCoordinate,
    totalHeight:
      coordinateGeometry.offsetForCoordinate(gridMaxRow) +
      coordinateGeometry.valueForCoordinate(gridMaxRow) -
      coordinateGeometry.offsetForCoordinate(gridMinRow),
  };
}

function sparseGridCoordinateGeometry({
  defaultValue,
  originCoordinate,
  overrides,
  stepGap,
}: {
  defaultValue: number;
  originCoordinate: number;
  overrides: ReadonlyMap<number, number>;
  stepGap: number;
}): {
  offsetForCoordinate: (coordinate: number) => number;
  valueForCoordinate: (coordinate: number) => number;
} {
  const overrideCoordinates = [...overrides.keys()].toSorted(
    (left, right) => left - right,
  );
  const cumulativeDifferences = [0];
  for (const coordinate of overrideCoordinates) {
    cumulativeDifferences.push(
      (cumulativeDifferences.at(-1) ?? 0) +
        (overrides.get(coordinate) ?? defaultValue) -
        defaultValue,
    );
  }
  const valueForCoordinate = (coordinate: number): number =>
    overrides.get(coordinate) ?? defaultValue;
  const originDifference =
    cumulativeDifferences[
      firstCoordinateAtOrAfter(overrideCoordinates, originCoordinate)
    ] ?? 0;
  const offsetForCoordinate = (coordinate: number): number => {
    const distance = integerCoordinateDistance(originCoordinate, coordinate);
    return (
      distance * (defaultValue + stepGap) +
      ((cumulativeDifferences[
        firstCoordinateAtOrAfter(overrideCoordinates, coordinate)
      ] ?? 0) -
        originDifference)
    );
  };
  return { offsetForCoordinate, valueForCoordinate };
}

function integerCoordinateDistance(start: number, end: number): number {
  const distance = end - start;
  return Number.isSafeInteger(distance)
    ? distance
    : Number(BigInt(end) - BigInt(start));
}

function firstCoordinateAtOrAfter(
  coordinates: readonly number[],
  target: number,
): number {
  let lower = 0;
  let upper = coordinates.length;
  while (lower < upper) {
    const midpoint = lower + Math.floor((upper - lower) / 2);
    if ((coordinates[midpoint] ?? Number.POSITIVE_INFINITY) < target) {
      lower = midpoint + 1;
    } else {
      upper = midpoint;
    }
  }
  return lower;
}

export function originGridRowRange(): GridRowRange {
  return {
    maxRow: 0,
    minRow: 0,
    originRow: 0,
  };
}

export function gridRowRangeAt(originRow: number): GridRowRange {
  return {
    maxRow: originRow,
    minRow: originRow,
    originRow,
  };
}

export function scrollOffsetForGridColumn(
  scrollColumn: number,
  geometry: Pick<ColumnGeometry, "gridOffsetForColumn">,
): number {
  const lowerColumn = Math.floor(scrollColumn);
  const upperColumn = Math.ceil(scrollColumn);
  const progress = scrollColumn - lowerColumn;
  const lowerOffset = geometry.gridOffsetForColumn(lowerColumn);
  const upperOffset = geometry.gridOffsetForColumn(upperColumn);
  return lowerOffset + (upperOffset - lowerOffset) * progress;
}

export function scrollOffsetForGridRow(
  scrollRow: number,
  geometry: Pick<GridRowGeometry, "gridOffsetForRow">,
): number {
  const lowerRow = Math.floor(scrollRow);
  const upperRow = Math.ceil(scrollRow);
  const progress = scrollRow - lowerRow;
  const lowerOffset = geometry.gridOffsetForRow(lowerRow);
  const upperOffset = geometry.gridOffsetForRow(upperRow);
  return lowerOffset + (upperOffset - lowerOffset) * progress;
}

export function pushColumnItems({
  availableHeight,
  column,
  columnWidth,
  focusedPaneId,
  fullSizePanes = false,
  maximizedPaneId = null,
  moving,
  paneById,
  presentationMode,
  push,
  pushReservedCell,
  scale,
  scene,
  x,
  yOffset = 0,
}: {
  availableHeight: number;
  column: WorkspaceColumn;
  columnWidth: number;
  focusedPaneId: PaneId | null;
  fullSizePanes?: boolean;
  maximizedPaneId?: PaneId | null;
  moving: boolean;
  paneById: Map<PaneId, WorkspacePane>;
  presentationMode: LayoutFrameInput["presentationMode"];
  push: (item: PaneRenderItem) => void;
  pushReservedCell?: (item: ReservedCellRenderItem) => void;
  scale: number;
  scene: Pick<
    WorkspaceScene,
    "padding" | "rowGap" | "paneDefaults" | "paneTypeDefaults"
  >;
  x: number;
  yOffset?: number;
}) {
  const cells = paneCellsForColumn(column, paneById);
  const totalGap = scene.rowGap * Math.max(0, cells.length - 1);
  const heights = paneHeightsForColumn(cells, availableHeight, totalGap, {
    fullSizePanes,
    maximizedPaneId,
    sizing: { configuration: scene, columnWidth },
  });
  let y = yOffset + scene.padding * scale;

  for (const [index, cell] of cells.entries()) {
    const pane = cell.pane;
    const height = heights[index] ?? minimumPaneRenderHeightPx;
    if (!pane) {
      pushReservedCellItem({
        cell,
        column,
        columnWidth,
        height,
        presentationMode,
        pushReservedCell,
        rowIndex: index,
        scale,
        x,
        y,
      });
      y += (height + scene.rowGap) * scale;
      continue;
    }
    const maximized = pane.paneId === maximizedPaneId;
    const focused = pane.paneId === focusedPaneId;
    push({
      focused,
      height,
      maximized,
      moving,
      opacity: 1,
      paneId: pane.paneId,
      planeIndex: column.planeIndex,
      presentationMode,
      resizing: false,
      runtimeState: "live",
      scale,
      surfaceId: pane.surfaceId,
      surfaceKind: pane.surfaceKind,
      visible: true,
      width: columnWidth,
      x,
      y,
      z: focused ? 2 : 1,
    });
    y += (height + scene.rowGap) * scale;
  }
}

function pushReservedCellItem({
  cell,
  column,
  columnWidth,
  height,
  presentationMode,
  pushReservedCell,
  rowIndex,
  scale,
  x,
  y,
}: {
  cell: PaneCellLayout;
  column: WorkspaceColumn;
  columnWidth: number;
  height: number;
  presentationMode: LayoutFrameInput["presentationMode"];
  pushReservedCell: ((item: ReservedCellRenderItem) => void) | undefined;
  rowIndex: number;
  scale: number;
  x: number;
  y: number;
}): void {
  if (!cell.reserved) {
    return;
  }
  pushReservedCell?.({
    columnId: column.columnId,
    height,
    planeIndex: column.planeIndex,
    presentationMode,
    rowIndex,
    scale,
    width: columnWidth,
    x,
    y,
  });
}

const minimumPaneRenderHeightPx = 42;

function planeOuterHeightForLayout({
  availableHeight,
  columns,
  fullSizePanes,
  maximizedPaneId,
  padding,
  paneById,
  rowGap,
  viewportHeight,
  sizing,
}: {
  availableHeight: number;
  columns: readonly WorkspaceColumn[];
  fullSizePanes: boolean;
  maximizedPaneId: PaneId | null;
  padding: number;
  paneById: Map<PaneId, WorkspacePane>;
  rowGap: number;
  viewportHeight: number;
  sizing?: PaneGridSizing;
}): number {
  if (columns.length === 0) {
    return Math.max(1, viewportHeight);
  }
  const columnHeights = columns.map((column) =>
    columnContentHeightForLayout({
      availableHeight,
      column,
      fullSizePanes,
      maximizedPaneId,
      paneById,
      rowGap,
      sizing,
    }),
  );
  return Math.max(1, Math.max(...columnHeights) + padding * 2);
}

function columnContentHeightForLayout({
  sizing,
  availableHeight,
  column,
  fullSizePanes,
  maximizedPaneId,
  paneById,
  rowGap,
}: {
  availableHeight: number;
  column: WorkspaceColumn;
  fullSizePanes: boolean;
  maximizedPaneId: PaneId | null;
  paneById: Map<PaneId, WorkspacePane>;
  rowGap: number;
  sizing?: PaneGridSizing;
}): number {
  const cells = paneCellsForColumn(column, paneById);
  if (cells.length === 0) {
    return Math.max(1, availableHeight);
  }
  const totalGap = rowGap * Math.max(0, cells.length - 1);
  const heights = paneHeightsForColumn(cells, availableHeight, totalGap, {
    fullSizePanes,
    maximizedPaneId,
    sizing: sizing
      ? {
          configuration: sizing.configuration,
          columnWidth: sizing.widthForColumn(column),
        }
      : undefined,
  });
  return heights.reduce((total, height) => total + height, 0) + totalGap;
}

export function paneHeightsForColumn(
  cells: readonly PaneCellLayout[],
  availableHeight: number,
  totalGap: number,
  {
    fullSizePanes = false,
    maximizedPaneId = null,
    sizing,
  }: {
    fullSizePanes?: boolean;
    maximizedPaneId?: PaneId | null;
    sizing?: PaneColumnSizing;
  } = {},
): number[] {
  const defaults = cells.map((cell) =>
    cell.pane ? resolvePaneDefaults(cell.pane, sizing?.configuration) : {},
  );
  const limited = (index: number) =>
    !sizing?.configuration.fullPaneSizing &&
    (maximizedPaneId === null || cells[index]?.paneId !== maximizedPaneId);
  const constrain = (height: number, index: number) =>
    constrainPaneDimension(
      height,
      limited(index) ? defaults[index]?.minHeight : undefined,
      limited(index) ? defaults[index]?.maxHeight : undefined,
      availableHeight,
      minimumPaneRenderHeightPx,
    );
  if (fullSizePanes)
    return cells.map((_cell, index) => constrain(availableHeight, index));
  const fixedHeights = cells.map((cell, index) => {
    if (cell.paneId !== null && cell.paneId === maximizedPaneId)
      return constrain(availableHeight, index);
    const preferred =
      cell.heightPx ??
      (sizing
        ? preferredPaneHeight(
            defaults[index] ?? {},
            sizing.columnWidth,
            availableHeight,
          )
        : undefined);
    return preferred === undefined ? null : constrain(preferred, index);
  });
  const fixedHeightTotal = fixedHeights.reduce<number>(
    (total, height) => total + (height ?? 0),
    0,
  );
  const flexibleCells = cells.filter(
    (_cell, index) => fixedHeights[index] === null,
  );
  const flexibleWeightTotal = flexibleCells.reduce(
    (total, cell) => total + cell.weight,
    0,
  );
  const flexibleHeight = Math.max(
    minimumPaneRenderHeightPx * flexibleCells.length,
    availableHeight - totalGap - fixedHeightTotal,
  );
  return cells.map((cell, index) => {
    const fixedHeight = fixedHeights[index];
    return constrain(
      fixedHeight ??
        (flexibleHeight * cell.weight) / Math.max(0.1, flexibleWeightTotal),
      index,
    );
  });
}

export function paneCellsForColumn(
  column: WorkspaceColumn,
  paneById: ReadonlyMap<PaneId, WorkspacePane>,
): PaneCellLayout[] {
  return column.cells.map((cell) => {
    const paneId = cell.paneId;
    return {
      ...(cell.heightPx === undefined ? {} : { heightPx: cell.heightPx }),
      pane: paneId ? (paneById.get(paneId) ?? null) : null,
      paneId,
      reserved: cell.reserved,
      weight: cell.weight,
    };
  });
}

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
