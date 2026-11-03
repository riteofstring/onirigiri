import type {
  ColumnWidthSpec,
  LayoutFrameInput,
  PaneId,
  PaneRenderItem,
  PaneWorldBox,
  Rect,
  ReservedCellRenderItem,
  WorkspaceColumn,
  WorkspaceGridCursor,
  WorkspaceGridOrigin,
  WorkspacePane,
  WorkspaceScene,
} from "../types.js";
import { columnSlotIndex, slotWidthsForColumns } from "./column-slots.js";
import {
  type ColumnGeometry,
  gridColumnGeometryForLayout,
  type GridColumnRange,
  gridColumnRangeAt,
  gridRowGeometryForLayout,
  type GridRowRange,
  gridRowRangeAt,
  minimumColumnWidth,
  originGridColumnRange,
  originGridRowRange,
  pushColumnItems,
} from "./layout-engine-helpers.js";
import {
  type OverviewLayoutContext,
  type OverviewLayoutMetrics,
  overviewLayoutMetrics,
  renderOverviewLayoutFrame,
} from "./layout-engine-rendering.js";
import { planeIndexesForColumns } from "./layout-planes.js";
import {
  constrainColumnWidths,
  preferredColumnWidth,
} from "./pane-defaults.js";

export interface WorkspaceLayoutEngineOptions {
  allowResizedPanesToOverflowViewport?: boolean;
  keepHeightWhenSplitting?: boolean;
  overviewCardMaxWidthPx?: number;
  overviewCardMinWidthPx?: number;
}

export class WorkspaceLayoutGeometry {
  constructor(
    protected scene: WorkspaceScene,
    protected options: WorkspaceLayoutEngineOptions = {},
  ) {}
  protected columns: WorkspaceColumn[] = [];

  protected compactLayout = false;

  protected compactPanePeekPx = 0;

  protected compactRenderScene: WorkspaceScene | null = null;

  protected paneById = new Map<PaneId, WorkspacePane>();

  protected resolvePaneWorldBoxes(
    viewport: Rect,
    maximizedPaneId: PaneId | null = null,
    origin: WorkspaceGridOrigin = { column: 0, row: 0 },
  ): readonly PaneWorldBox[] {
    const scene = this.renderScene();
    const geometry = this.columnGeometry(
      viewport,
      maximizedPaneId,
      this.scene.columnGap,
      this.options.allowResizedPanesToOverflowViewport ?? false,
      gridColumnRangeAt(origin.column),
    );
    const rowGeometry = this.normalGridRowGeometry(
      viewport,
      maximizedPaneId,
      geometry,
      gridRowRangeAt(origin.row),
    );
    const inlineOffset = this.compactInlinePadding(viewport.width);
    const boxes: PaneWorldBox[] = [];
    for (const column of this.columns) {
      pushColumnItems({
        availableHeight: this.availablePaneHeight(viewport.height),
        column,
        columnWidth: geometry.gridWidthForColumn(columnSlotIndex(column)),
        focusedPaneId: null,
        fullSizePanes: this.compactLayout,
        maximizedPaneId,
        moving: false,
        paneById: this.paneById,
        presentationMode: "normal",
        push: (item) =>
          boxes.push({
            height: item.height,
            paneId: item.paneId,
            scale: 1,
            width: item.width,
            x: item.x,
            y: item.y,
          }),
        scale: 1,
        scene,
        x: inlineOffset + geometry.gridOffsetForColumn(columnSlotIndex(column)),
        yOffset: rowGeometry.gridOffsetForRow(column.planeIndex),
      });
    }
    return boxes;
  }

  protected scenePadding(): number {
    return this.compactLayout ? 0 : this.scene.padding;
  }

  protected renderScene(): WorkspaceScene {
    if (!this.compactLayout) {
      return this.scene;
    }
    this.compactRenderScene ??= { ...this.scene, padding: 0 };
    return this.compactRenderScene;
  }

  protected availablePaneHeight(viewportHeight: number): number {
    return Math.max(1, viewportHeight - this.scenePadding() * 2);
  }

  protected normalGridRowGeometry(
    viewport: Rect,
    maximizedPaneId: PaneId | null,
    geometry: ColumnGeometry,
    gridRange: GridRowRange = originGridRowRange(),
  ) {
    const scene = this.renderScene();
    return gridRowGeometryForLayout({
      availableHeight: this.availablePaneHeight(viewport.height),
      columns: this.columns,
      fullSizePanes: this.compactLayout,
      gridRange,
      maximizedPaneId,
      padding: scene.padding,
      paneById: this.paneById,
      planeGap: this.scene.columnGap,
      rowGap: scene.rowGap,
      viewportHeight: viewport.height,
      sizing: {
        configuration: scene,
        widthForColumn: (column) =>
          geometry.gridWidthForColumn(columnSlotIndex(column)),
      },
    });
  }

  protected availableWidth(viewportWidth: number): number {
    const inlinePadding = this.compactInlinePadding(viewportWidth);
    return Math.max(1, viewportWidth - inlinePadding * 2);
  }

  protected availableViewportWidth(viewportWidth: number): number {
    return Math.max(1, viewportWidth - this.scenePadding() * 2);
  }

  protected columnGeometry(
    viewport: Rect,
    maximizedPaneId: PaneId | null = null,
    columnGap = this.scene.columnGap,
    allowViewportOverflow = this.options.allowResizedPanesToOverflowViewport ??
      false,
    gridRange: GridColumnRange = originGridColumnRange(),
  ): ColumnGeometry {
    const viewportWidth = viewport.width;
    const rawWidths = this.columns.map((column) =>
      this.compactLayout ||
      (maximizedPaneId &&
        column.cells.some((cell) => cell.paneId === maximizedPaneId))
        ? this.availableWidth(viewportWidth)
        : preferredColumnWidth({
            column,
            fallback: this.resolveColumnWidth(
              column,
              viewportWidth,
              allowViewportOverflow,
            ),
            paneById: this.paneById,
            configuration: this.scene,
            availableWidth: this.availableViewportWidth(viewportWidth),
            availableHeight: this.availablePaneHeight(viewport.height),
          }),
    );
    const defaultWidth = this.resolveColumnWidthSpec(
      this.scene.defaultColumnWidthSpec,
      viewportWidth,
      allowViewportOverflow,
    );
    const slotWidths = slotWidthsForColumns({
      columns: this.columns,
      defaultWidth,
      widths: rawWidths,
    });
    constrainColumnWidths({
      available: this.maximumColumnWidth(viewportWidth, allowViewportOverflow),
      columns: this.columns,
      configuration: this.scene,
      maximizedPaneId,
      paneById: this.paneById,
      widths: slotWidths,
    });
    const widths = this.columns.map((column) =>
      slotWidths.get(columnSlotIndex(column))!,
    );
    if (this.compactLayout) {
      return this.compactColumnGeometry(
        widths,
        defaultWidth,
        columnGap,
        gridRange,
      );
    }
    const gridGeometry = gridColumnGeometryForLayout({
      columnGap,
      defaultWidth,
      range: gridRange,
      slotWidths,
    });
    const offsets = Array.from({ length: this.columns.length }, () => 0);
    for (const column of this.columns) {
      offsets[column.index] = gridGeometry.gridOffsetForColumn(
        columnSlotIndex(column),
      );
    }
    return { ...gridGeometry, offsets, widths };
  }

  private compactColumnGeometry(
    widths: number[],
    defaultWidth: number,
    columnGap: number,
    gridRange: GridColumnRange,
  ): ColumnGeometry {
    const offsets = Array.from({ length: this.columns.length }, () => 0);
    const compactColumnWidth = widths[0] ?? defaultWidth;
    const slotWidths = new Map<number, number>();
    for (const column of this.columns) {
      slotWidths.set(columnSlotIndex(column), compactColumnWidth);
    }
    const gridGeometry = gridColumnGeometryForLayout({
      columnGap,
      defaultWidth: compactColumnWidth,
      range: gridRange,
      slotWidths,
    });
    for (const column of this.columns) {
      offsets[column.index] = gridGeometry.gridOffsetForColumn(
        columnSlotIndex(column),
      );
    }
    return { ...gridGeometry, offsets, widths };
  }

  protected compactInlinePadding(viewportWidth: number): number {
    if (!this.compactLayout || this.compactPanePeekPx <= 0) {
      return this.scenePadding();
    }
    const requestedPadding = this.compactPanePeekPx + this.scene.columnGap;
    const availablePadding = Math.max(
      0,
      (viewportWidth - minimumColumnWidth) / 2,
    );
    return Math.min(requestedPadding, availablePadding);
  }

  protected renderOverviewFrame(
    input: LayoutFrameInput,
    push: (item: PaneRenderItem) => void,
    pushReservedCell?: (item: ReservedCellRenderItem) => void,
  ): void {
    renderOverviewLayoutFrame({
      ...this.overviewLayoutContext(input),
      push,
      pushReservedCell,
    });
  }

  overviewContentBounds(
    viewport: Rect,
    maximizedPaneId: PaneId | null = null,
    overviewZoom = 1,
    cursor: WorkspaceGridCursor | undefined = undefined,
    overviewFixedScale: number | undefined = undefined,
  ): OverviewLayoutMetrics {
    return overviewLayoutMetrics(
      this.overviewLayoutContext({
        ...(cursor === undefined ? {} : { cursor }),
        focusedPaneId: null,
        maximizedPaneId,
        movementPhase: "idle",
        ...(overviewFixedScale === undefined ? {} : { overviewFixedScale }),
        overviewZoom,
        presentationMode: "overview",
        scrollColumn: 0,
        scrollRow: 0,
        viewport,
      }),
    );
  }

  protected overviewLayoutContext(
    input: LayoutFrameInput,
  ): OverviewLayoutContext {
    return {
      availableHeight: this.availablePaneHeight(input.viewport.height),
      cardSizeConstraints: {
        maxWidthPx: this.options.overviewCardMaxWidthPx,
        minWidthPx: this.options.overviewCardMinWidthPx,
      },
      columns: this.columns,
      fullSizePanes: this.compactLayout,
      geometry: this.columnGeometry(
        input.viewport,
        input.maximizedPaneId,
        this.scene.columnGap,
        this.options.allowResizedPanesToOverflowViewport ?? false,
        this.overviewGridColumnRange(input.cursor),
      ),
      input,
      paneById: this.paneById,
      planeIndexes: this.planeIndexes(),
      scene: this.renderScene(),
    };
  }

  private overviewGridColumnRange(
    cursor: WorkspaceGridCursor | undefined,
  ): GridColumnRange {
    const cursorColumn = cursor?.column ?? 0;
    const slotIndexes = this.columns.map((column) => columnSlotIndex(column));
    const minColumn = Math.min(cursorColumn, ...slotIndexes);
    return {
      maxColumn: Math.max(cursorColumn, ...slotIndexes),
      minColumn,
      originColumn: minColumn,
    };
  }

  protected planeIndexes(): number[] {
    return planeIndexesForColumns(this.columns);
  }

  protected resolveColumnWidth(
    column: WorkspaceColumn,
    viewportWidth: number,
    allowViewportOverflow = this.options.allowResizedPanesToOverflowViewport ??
      false,
  ): number {
    return this.resolveColumnWidthSpec(
      column.widthSpec,
      viewportWidth,
      allowViewportOverflow,
    );
  }

  protected resolveColumnWidthSpec(
    spec: ColumnWidthSpec,
    viewportWidth: number,
    allowViewportOverflow = this.options.allowResizedPanesToOverflowViewport ??
      false,
  ): number {
    if (spec.unit === "px") {
      const desiredWidth = Math.max(minimumColumnWidth, Math.round(spec.value));
      return Math.min(
        desiredWidth,
        this.maximumColumnWidth(viewportWidth, allowViewportOverflow),
      );
    }
    return Math.min(
      this.availableViewportWidth(viewportWidth),
      Math.max(
        minimumColumnWidth,
        Math.round(this.availableWidth(viewportWidth) * spec.value),
      ),
    );
  }

  private maximumColumnWidth(
    viewportWidth: number,
    allowOverflow: boolean,
  ): number {
    return allowOverflow
      ? Number.POSITIVE_INFINITY
      : this.availableViewportWidth(viewportWidth);
  }
}
