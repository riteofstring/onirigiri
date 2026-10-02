import { columnSlotIndex } from "./column-slots.js";
import {
  applyOverviewZoom,
  clamp,
  columnsByIndexes,
  gridRowGeometryForLayout,
  gridRowRangeAt,
  type GridRowGeometry,
  minimumColumnWidth,
  overviewScale,
  pushColumnItems,
  renderedColumnIndexesForLayout,
  scrollOffsetForGridColumn,
  scrollOffsetForGridRow,
  type ColumnGeometry,
  type OverviewCardSizeConstraints,
} from "./layout-engine-helpers.js";
import type {
  LayoutFrameInput,
  PaneId,
  PaneRenderItem,
  ReservedCellRenderItem,
  WorkspaceColumn,
  WorkspacePane,
  WorkspaceScene,
} from "../types.js";

interface RenderFrameContext {
  availableHeight: number;
  columns: WorkspaceColumn[];
  fullSizePanes: boolean;
  geometry: ColumnGeometry;
  inlinePadding?: number;
  input: LayoutFrameInput;
  paneById: Map<PaneId, WorkspacePane>;
  planeIndexes: number[];
  push: (item: PaneRenderItem) => void;
  pushReservedCell?: (item: ReservedCellRenderItem) => void;
  scene: WorkspaceScene;
}

export function renderNormalLayoutFrame({
  availableHeight,
  columns,
  fullSizePanes,
  geometry,
  input,
  paneById,
  push,
  pushReservedCell,
  scene,
  inlinePadding = scene.padding,
}: RenderFrameContext): void {
  const maximizedPaneId = input.maximizedPaneId;
  const scrollColumn = input.scrollColumn;
  const horizontalPanOffset =
    scrollOffsetForGridColumn(scrollColumn, geometry) +
    (input.horizontalAnchorOffset ?? 0);
  const planeGeometry = gridRowGeometryForLayout({
    availableHeight,
    columns,
    fullSizePanes,
    gridRange: gridRowRangeAt(Math.floor(input.scrollRow)),
    maximizedPaneId,
    padding: scene.padding,
    paneById,
    planeGap: scene.columnGap,
    rowGap: scene.rowGap,
    viewportHeight: input.viewport.height,
    sizing: {
      configuration: scene,
      widthForColumn: (column) =>
        geometry.gridWidthForColumn(columnSlotIndex(column)),
    },
  });
  const verticalOffset =
    scrollOffsetForGridRow(input.scrollRow, planeGeometry) +
    (input.verticalAnchorOffset ?? 0);
  const columnIndexes = includeFocusedColumn(
    renderedColumnIndexesForLayout({
      columns,
      geometry,
      horizontalAnchorOffset: input.horizontalAnchorOffset,
      inlinePadding,
      planeGeometry,
      renderAllColumns: input.renderAllColumns ?? false,
      scene,
      scrollColumn,
      verticalOffset,
      viewport: input.viewport,
    }),
    columns,
    input.focusedPaneId,
  );

  for (const column of columnsByIndexes(columns, columnIndexes)) {
    const columnWidth = geometry.widths[column.index] ?? minimumColumnWidth;
    const x =
      input.viewport.x +
      inlinePadding +
      (geometry.offsets[column.index] ?? 0) +
      -horizontalPanOffset;
    const planeTop = planeGeometry.gridOffsetForRow(column.planeIndex);
    pushColumnItems({
      availableHeight,
      column,
      columnWidth,
      focusedPaneId: input.focusedPaneId,
      fullSizePanes,
      maximizedPaneId,
      moving: input.movementPhase === "moving",
      paneById,
      presentationMode: input.presentationMode,
      push,
      pushReservedCell,
      scale: 1,
      scene,
      x,
      yOffset: planeTop - verticalOffset,
    });
  }
}

function includeFocusedColumn(
  columnIndexes: readonly number[],
  columns: readonly WorkspaceColumn[],
  focusedPaneId: PaneId | null,
): number[] {
  if (!focusedPaneId) {
    return [...columnIndexes];
  }
  const focusedColumnIndex = columns.find((column) =>
    column.cells.some((cell) => cell.paneId === focusedPaneId),
  )?.index;
  if (
    focusedColumnIndex === undefined ||
    columnIndexes.includes(focusedColumnIndex)
  ) {
    return [...columnIndexes];
  }
  return [...columnIndexes, focusedColumnIndex];
}

export interface OverviewLayoutMetrics {
  baseXOffset: number;
  baseYOffset: number;
  contentHeight: number;
  contentWidth: number;
  fitScale: number;
  maxPanX: number;
  maxPanY: number;
  scale: number;
}

interface OverviewLayoutGeometry extends OverviewLayoutMetrics {
  planeGeometry: GridRowGeometry;
}

export interface OverviewLayoutContext {
  availableHeight: number;
  cardSizeConstraints?: OverviewCardSizeConstraints;
  columns: WorkspaceColumn[];
  fullSizePanes: boolean;
  geometry: ColumnGeometry;
  input: LayoutFrameInput;
  paneById: Map<PaneId, WorkspacePane>;
  planeIndexes: number[];
  scene: WorkspaceScene;
}

export function overviewLayoutMetrics(
  context: OverviewLayoutContext,
): OverviewLayoutMetrics {
  const {
    baseXOffset,
    baseYOffset,
    contentHeight,
    contentWidth,
    fitScale,
    maxPanX,
    maxPanY,
    scale,
  } = overviewLayoutGeometry(context);
  return {
    baseXOffset,
    baseYOffset,
    contentHeight,
    contentWidth,
    fitScale,
    maxPanX,
    maxPanY,
    scale,
  };
}

export function overviewLayoutGeometry({
  availableHeight,
  cardSizeConstraints,
  columns,
  fullSizePanes,
  geometry,
  input,
  paneById,
  planeIndexes,
  scene,
}: OverviewLayoutContext): OverviewLayoutGeometry {
  const planeGeometry = gridRowGeometryForLayout({
    availableHeight,
    columns,
    fullSizePanes,
    gridRange: overviewGridRowRange(input, planeIndexes),
    maximizedPaneId: input.maximizedPaneId,
    padding: scene.padding,
    paneById,
    planeGap: scene.columnGap,
    rowGap: scene.rowGap,
    viewportHeight: input.viewport.height,
    sizing: {
      configuration: scene,
      widthForColumn: (column) =>
        geometry.gridWidthForColumn(columnSlotIndex(column)),
    },
  });
  const unscaledWidth = gridContentWidth(geometry);
  const unscaledHeight = planeGeometry.totalHeight;
  const fitScale = overviewScale({
    cardSizeConstraints,
    height: unscaledHeight,
    padding: scene.padding,
    referenceCardWidth: maxOverviewCardWidth(columns, geometry),
    viewport: input.viewport,
    width: unscaledWidth,
  });
  const fixedScale = input.overviewFixedScale;
  const scale =
    typeof fixedScale === "number" &&
    Number.isFinite(fixedScale) &&
    fixedScale > 0
      ? fixedScale
      : applyOverviewZoom(fitScale, input.overviewZoom);
  const contentWidth = unscaledWidth * scale;
  const contentHeight = unscaledHeight * scale;
  const baseXOffset = Math.max(
    input.viewport.x + scene.padding,
    input.viewport.x + Math.floor((input.viewport.width - contentWidth) / 2),
  );
  const baseYOffset = Math.max(
    0,
    Math.floor((input.viewport.height - contentHeight) / 2),
  );
  return {
    baseXOffset,
    baseYOffset,
    contentHeight,
    contentWidth,
    fitScale,
    maxPanX: Math.max(
      0,
      baseXOffset -
        input.viewport.x +
        contentWidth -
        input.viewport.width +
        scene.padding,
    ),
    maxPanY: Math.max(
      0,
      baseYOffset + contentHeight - input.viewport.height + scene.padding,
    ),
    planeGeometry,
    scale,
  };
}

export function renderOverviewLayoutFrame(
  context: RenderFrameContext & {
    cardSizeConstraints?: OverviewCardSizeConstraints;
  },
): void {
  const {
    availableHeight,
    columns,
    fullSizePanes,
    geometry,
    input,
    paneById,
    push,
    pushReservedCell,
    scene,
  } = context;
  const computed = overviewLayoutGeometry(context);
  const planeGeometry = computed.planeGeometry;
  const { baseXOffset, baseYOffset, maxPanX, maxPanY, scale } = computed;
  const panX = clamp(input.overviewPanX ?? 0, 0, maxPanX);
  const panY = clamp(input.overviewPanY ?? 0, 0, maxPanY);
  const xOffset =
    baseXOffset -
    panX +
    finiteOverviewFollowOffset(input.overviewFollowOffsetX);
  const yOffset =
    baseYOffset -
    panY +
    finiteOverviewFollowOffset(input.overviewFollowOffsetY);

  for (const column of columns) {
    const columnWidth = geometry.widths[column.index] ?? minimumColumnWidth;
    pushColumnItems({
      availableHeight,
      column,
      columnWidth,
      focusedPaneId: input.focusedPaneId,
      fullSizePanes,
      maximizedPaneId: input.maximizedPaneId,
      moving: input.movementPhase === "moving",
      paneById,
      presentationMode: input.presentationMode,
      push,
      pushReservedCell,
      scale,
      scene,
      x: xOffset + (geometry.offsets[column.index] ?? 0) * scale,
      yOffset:
        yOffset + planeGeometry.gridOffsetForRow(column.planeIndex) * scale,
    });
  }
}

function finiteOverviewFollowOffset(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function overviewGridRowRange(
  input: LayoutFrameInput,
  planeIndexes: number[],
): { maxRow: number; minRow: number; originRow: number } {
  const cursorRow = input.cursor?.row ?? 0;
  const minRow = Math.min(cursorRow, ...planeIndexes);
  return {
    maxRow: Math.max(cursorRow, ...planeIndexes),
    minRow,
    originRow: minRow,
  };
}

function gridContentWidth(geometry: ColumnGeometry): number {
  const minimumOffset = geometry.gridOffsetForColumn(geometry.gridMinColumn);
  const maximumOffset = geometry.gridOffsetForColumn(geometry.gridMaxColumn);
  return Math.max(
    minimumColumnWidth,
    maximumOffset +
      geometry.gridWidthForColumn(geometry.gridMaxColumn) -
      minimumOffset,
  );
}

function maxOverviewCardWidth(
  columns: WorkspaceColumn[],
  geometry: ColumnGeometry,
): number {
  return Math.max(
    minimumColumnWidth,
    ...columns.map(
      (column) => geometry.widths[column.index] ?? minimumColumnWidth,
    ),
  );
}
