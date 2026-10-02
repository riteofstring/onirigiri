import {
  constrainColumnWidths,
  constrainSplitHeights,
  resolvePaneDefaults,
  preferredColumnWidth,
  validatePaneDefaultsConfiguration,
} from "./pane-defaults.js";
import {
  columnSlotIndex,
  compareColumnsByPlaneAndSlot,
  nextSlotIndexForPlane,
  normalizeColumnSlots,
  planeHasSlot,
  shiftPlaneSlotsAtOrAfter,
  slotIndexForDenseInsertion,
  slotWidthsForColumns,
} from "./column-slots.js";
import {
  clamp,
  type ColumnGeometry,
  gridColumnGeometryForLayout,
  gridColumnRangeAt,
  gridRowGeometryForLayout,
  gridRowRangeAt,
  originGridColumnRange,
  originGridRowRange,
  type GridColumnRange,
  type GridRowRange,
  minimumColumnWidth,
  nextNumericSuffix,
  normalizedColumnWidthSpec,
  type PaneLocation,
  pushColumnItems,
} from "./layout-engine-helpers.js";
import {
  normalizedPaneHeightPx,
  normalizedPaneWeight,
} from "./layout-engine-normalization.js";
import {
  locationsFormAdjacentSplit,
  resizedSplitSizing,
} from "./layout-engine-rearrangement-helpers.js";
import {
  type OverviewLayoutContext,
  type OverviewLayoutMetrics,
  overviewLayoutMetrics,
  renderOverviewLayoutFrame,
} from "./layout-engine-rendering.js";
import {
  insertPlaneAt,
  planeIndexesForColumns,
  removePlaneAt,
} from "./layout-planes.js";
import type {
  ColumnId,
  ColumnWidthSpec,
  LayoutFrameInput,
  PaneId,
  PaneDefaultsConfiguration,
  PaneRenderItem,
  PaneWorldBox,
  Rect,
  ReservedCellRenderItem,
  WorkspaceColumn,
  WorkspaceCell,
  WorkspaceGridCursor,
  WorkspacePane,
  WorkspaceGridOrigin,
  WorkspaceScene,
} from "../types.js";

interface WorkspaceLayoutEngineOptions {
  allowResizedPanesToOverflowViewport?: boolean;
  overviewCardMaxWidthPx?: number;
  overviewCardMinWidthPx?: number;
}

export abstract class WorkspaceLayoutEngineBase {
  protected columns: WorkspaceColumn[] = [];
  protected compactLayout = false;
  protected compactPanePeekPx = 0;
  protected compactRenderScene: WorkspaceScene | null = null;
  protected nextColumnSequence = 1;
  protected nextPaneSequence = 1;
  protected nextSurfaceSequence = 1;
  protected paneById = new Map<PaneId, WorkspacePane>();
  private renderConfigurationVersion = 0;
  private paneDefaultsIdentity = "";
  protected scene: WorkspaceScene;

  constructor(
    scene: WorkspaceScene,
    protected readonly options: WorkspaceLayoutEngineOptions = {},
  ) {
    this.scene = scene;
    this.restoreScene(scene);
  }

  restoreScene(scene: WorkspaceScene): void {
    this.scene = scene;
    this.paneDefaultsIdentity = JSON.stringify([
      scene.paneDefaults,
      scene.paneTypeDefaults,
    ]);
    this.columns = normalizeColumnSlots(
      scene.columns.map((column) => ({
        ...column,
        cells: column.cells.map(cloneWorkspaceCell),
        idealWidthSpec: { ...column.idealWidthSpec },
        widthSpec: { ...column.widthSpec },
      })),
    );
    this.reindexColumns();
    this.paneById = new Map(scene.paneById);
    this.nextColumnSequence = nextNumericSuffix(
      this.columns,
      "workspace_column_",
      (column) => column.columnId,
    );
    this.nextPaneSequence = Math.max(
      scene.totalPanes,
      nextNumericSuffix(scene.panes, "workspace_pane_", (pane) => pane.paneId),
    );
    this.nextSurfaceSequence = Math.max(
      scene.totalPanes,
      nextNumericSuffix(
        scene.panes,
        "workspace_surface_",
        (pane) => pane.surfaceId,
      ),
    );
    this.compactRenderScene = null;
  }

  setPaneDefaults(configuration: PaneDefaultsConfiguration): boolean {
    validatePaneDefaultsConfiguration(configuration);
    const identity = JSON.stringify([
      configuration.paneDefaults,
      configuration.paneTypeDefaults,
    ]);
    if (identity === this.paneDefaultsIdentity) return false;
    this.paneDefaultsIdentity = identity;
    this.scene = {
      ...this.scene,
      paneDefaults: configuration.paneDefaults,
      paneTypeDefaults: configuration.paneTypeDefaults,
    };
    this.compactRenderScene = null;
    this.renderConfigurationVersion += 1;
    return true;
  }

  setFullPaneSizing(fullPaneSizing: boolean): void {
    if ((this.scene.fullPaneSizing ?? false) === fullPaneSizing) return;
    this.scene = { ...this.scene, fullPaneSizing };
    this.compactRenderScene = null;
    this.renderConfigurationVersion += 1;
  }

  setCompactLayout(compact: boolean, panePeekPx = 0): void {
    const nextPanePeek = compact ? normalizedCompactPanePeek(panePeekPx) : 0;
    if (
      compact === this.compactLayout &&
      nextPanePeek === this.compactPanePeekPx
    ) {
      return;
    }
    this.compactLayout = compact;
    this.compactPanePeekPx = nextPanePeek;
    this.renderConfigurationVersion += 1;
  }

  renderConfigurationRevision(): number {
    return this.renderConfigurationVersion;
  }

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

  protected appendColumn(
    widthSpec: ColumnWidthSpec = this.scene.defaultColumnWidthSpec,
    planeIndex = 0,
  ): WorkspaceColumn {
    const normalizedWidthSpec = normalizedColumnWidthSpec(widthSpec);
    const column: WorkspaceColumn = {
      columnId: this.nextColumnId(),
      cells: [],
      idealWidthSpec: { ...normalizedWidthSpec },
      index: this.columns.length,
      planeIndex,
      previousProportionWidth:
        normalizedWidthSpec.unit === "proportion"
          ? normalizedWidthSpec.value
          : undefined,
      slotIndex: nextSlotIndexForPlane(this.columnsInPlane(planeIndex)),
      widthSpec: { ...normalizedWidthSpec },
    };
    this.columns.push(column);
    this.reindexColumns();
    return column;
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

  protected insertAdjacentColumn(
    source: PaneLocation,
    direction: "left" | "right",
    widthSpec: ColumnWidthSpec = this.scene.defaultColumnWidthSpec,
  ): WorkspaceColumn {
    const planeColumnIndex =
      source.planeColumnIndex + (direction === "left" ? 0 : 1);
    return this.insertColumnInPlane(
      source.planeIndex,
      planeColumnIndex,
      widthSpec,
    );
  }

  protected insertColumnAfter(
    adjacentToColumnId: ColumnId | undefined,
    widthSpec: ColumnWidthSpec = this.scene.defaultColumnWidthSpec,
  ): WorkspaceColumn {
    if (!adjacentToColumnId) {
      return this.appendColumn(widthSpec);
    }
    const adjacentColumn = this.requireColumn(adjacentToColumnId);
    return this.insertColumnInPlane(
      adjacentColumn.planeIndex,
      this.planeColumnIndex(adjacentColumn) + 1,
      widthSpec,
    );
  }

  protected insertColumnInPlane(
    planeIndex: number,
    planeColumnIndex: number,
    widthSpec: ColumnWidthSpec = this.scene.defaultColumnWidthSpec,
  ): WorkspaceColumn {
    return this.insertColumnInPlaneSlot(
      planeIndex,
      slotIndexForDenseInsertion(
        this.columnsInPlane(planeIndex),
        planeColumnIndex,
      ),
      widthSpec,
    );
  }

  protected insertColumnInPlaneSlot(
    planeIndex: number,
    slotIndex: number,
    widthSpec: ColumnWidthSpec = this.scene.defaultColumnWidthSpec,
  ): WorkspaceColumn {
    const normalizedPlaneIndex = this.normalizedColumnPlaneIndex(planeIndex);
    const normalizedWidthSpec = normalizedColumnWidthSpec(widthSpec);
    const normalizedSlotIndex = Math.max(0, Math.floor(slotIndex));
    if (
      planeHasSlot(
        this.columnsInPlane(normalizedPlaneIndex),
        normalizedSlotIndex,
      )
    ) {
      this.columns = shiftPlaneSlotsAtOrAfter(
        this.columns,
        normalizedPlaneIndex,
        normalizedSlotIndex,
      );
    }
    const column: WorkspaceColumn = {
      columnId: this.nextColumnId(),
      cells: [],
      idealWidthSpec: { ...normalizedWidthSpec },
      index: this.columns.length,
      planeIndex: normalizedPlaneIndex,
      previousProportionWidth:
        normalizedWidthSpec.unit === "proportion"
          ? normalizedWidthSpec.value
          : undefined,
      slotIndex: normalizedSlotIndex,
      widthSpec: { ...normalizedWidthSpec },
    };
    this.columns.push(column);
    this.reindexColumns();
    return this.requireColumn(column.columnId);
  }

  protected normalizedColumnPlaneIndex(planeIndex: number): number {
    if (!Number.isFinite(planeIndex)) {
      throw new Error(
        `workspace layout plane index must be finite, got ${String(planeIndex)}`,
      );
    }
    const planeCount = this.planeIndexes().length;
    return Math.min(planeCount, Math.max(0, Math.floor(planeIndex)));
  }

  protected insertPlaneBeside(
    planeIndex: number,
    direction: "up" | "down",
  ): number {
    const result = insertPlaneAt(
      this.columns,
      planeIndex + (direction === "down" ? 1 : 0),
    );
    this.columns = result.columns;
    return result.planeIndex;
  }

  protected insertPaneBesideSource(
    createdPaneId: PaneId,
    source: PaneLocation,
    direction: "up" | "down",
  ): void {
    const column = this.columns[source.columnIndex];
    if (!column) {
      return;
    }
    const createdIndex = column.cells.findIndex(
      (cell) => cell.paneId === createdPaneId,
    );
    if (createdIndex >= 0) {
      const [createdCell] = column.cells.splice(createdIndex, 1);
      column.cells.splice(
        source.rowIndex + (direction === "down" ? 1 : 0),
        0,
        createdCell ?? { ...defaultWorkspaceCell(), paneId: createdPaneId },
      );
      return;
    }
    column.cells.splice(source.rowIndex + (direction === "down" ? 1 : 0), 0, {
      ...defaultWorkspaceCell(),
      paneId: createdPaneId,
    });
  }

  protected locationForPane(paneId: PaneId): PaneLocation | null {
    for (const column of this.columns) {
      const rowIndex = column.cells.findIndex((cell) => cell.paneId === paneId);
      if (rowIndex >= 0) {
        return {
          columnIndex: column.index,
          planeColumnIndex: this.planeColumnIndex(column),
          planeIndex: column.planeIndex,
          rowIndex,
        };
      }
    }
    return null;
  }

  protected movePaneStateToColumn(
    paneId: PaneId,
    destinationColumnId: ColumnId,
  ): void {
    const pane = this.paneById.get(paneId);
    if (!pane) {
      return;
    }
    this.paneById.set(paneId, { ...pane, columnId: destinationColumnId });
  }

  protected appendPaneCell(
    column: WorkspaceColumn,
    paneId: PaneId,
    sizing = defaultCellSizing(),
  ): void {
    column.cells.push({ ...sizing, paneId, reserved: false });
  }

  protected cellSizingForPane(paneId: PaneId) {
    const location = this.locationForPane(paneId);
    if (!location) {
      return null;
    }
    const column = this.columns[location.columnIndex];
    if (!column) {
      return null;
    }
    const cell = column.cells[location.rowIndex];
    return cell ? cellSizingForCell(cell) : null;
  }

  protected setCellSizingForPane(
    paneId: PaneId,
    sizing: { heightPx?: number; weight: number },
  ): boolean {
    const location = this.locationForPane(paneId);
    const column = location ? this.columns[location.columnIndex] : undefined;
    if (!location || !column) {
      return false;
    }
    const cell = column.cells[location.rowIndex];
    if (!cell) {
      return false;
    }
    const { heightPx: _previousHeightPx, ...cellWithoutHeight } = cell;
    column.cells[location.rowIndex] = {
      ...(sizing.heightPx === undefined
        ? cellWithoutHeight
        : { ...cell, heightPx: sizing.heightPx }),
      weight: sizing.weight,
    };
    return true;
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

  protected nextColumnId(): ColumnId {
    const columnId = this.peekNextColumnId();
    this.nextColumnSequence += 1;
    return columnId;
  }

  protected peekNextColumnId(): ColumnId {
    return `workspace_column_${this.nextColumnSequence}`;
  }

  protected removeEmptyColumns(): void {
    const emptyPlaneIndexes = this.planeIndexes()
      .filter(
        (planeIndex) =>
          !this.columns.some(
            (column) =>
              column.planeIndex === planeIndex && columnHasStructure(column),
          ),
      )
      .toSorted((left, right) => right - left);
    for (const planeIndex of emptyPlaneIndexes) {
      this.columns = removePlaneAt(this.columns, planeIndex);
    }
    this.columns = this.columns.filter(columnHasStructure);
    this.reindexColumns();
  }

  protected removeEmptyColumnsPreservingGridCoordinates(): void {
    this.columns = this.columns.filter(columnHasStructure);
    this.reindexColumns();
  }

  protected normalizeTransientCells(column: WorkspaceColumn): void {
    if (column.cells.some((cell) => cell.reserved)) {
      return;
    }
    const occupiedCells = column.cells.filter((cell) => cell.paneId !== null);
    if (occupiedCells.length === 0) {
      column.cells = [];
      return;
    }
    if (occupiedCells.length === 1) {
      const [occupiedCell] = occupiedCells;
      if (!occupiedCell) {
        return;
      }
      column.cells = [
        {
          paneId: occupiedCell.paneId,
          reserved: false,
          weight: 1,
        },
      ];
    }
  }

  protected requireColumn(columnId: ColumnId): WorkspaceColumn {
    const column = this.columns.find(
      (candidate) => candidate.columnId === columnId,
    );
    if (!column) {
      throw new Error(`unknown workspace column ${columnId}`);
    }
    return column;
  }

  protected resizeColumnsInSlot(
    slotIndex: number,
    width: ColumnWidthSpec,
    override = true,
  ): void {
    const normalizedWidthSpec = normalizedColumnWidthSpec(width);
    for (const column of this.columns) {
      if (columnSlotIndex(column) !== slotIndex) {
        continue;
      }
      column.widthSpec = { ...normalizedWidthSpec };
      column.widthOverride = override;
      if (column.widthSpec.unit === "proportion") {
        column.previousProportionWidth = column.widthSpec.value;
      }
    }
  }

  resetWorkspaceSizing(): void {
    this.setFullPaneSizing(false);
    const widthSpec = normalizedColumnWidthSpec(
      this.scene.defaultColumnWidthSpec,
    );
    this.columns = this.columns.map((column) => {
      const {
        previousProportionWidth: _previousProportionWidth,
        ...nextColumn
      } = column;
      return {
        ...nextColumn,
        widthOverride: false,
        cells: column.cells.map((cell) => {
          const { heightPx: _heightPx, ...nextCell } = cell;
          return { ...nextCell, weight: 1 };
        }),
        ...(widthSpec.unit === "proportion"
          ? { previousProportionWidth: widthSpec.value }
          : {}),
        widthSpec: { ...widthSpec },
      };
    });
  }

  protected adjacentPlaneIndex(
    planeIndex: number,
    direction: "up" | "down",
  ): number | null {
    const indexes = this.planeIndexes();
    const currentIndex = indexes.indexOf(planeIndex);
    if (currentIndex < 0) {
      return null;
    }
    return indexes[currentIndex + (direction === "up" ? -1 : 1)] ?? null;
  }

  protected columnsInPlane(planeIndex: number): WorkspaceColumn[] {
    return this.columns.filter((column) => column.planeIndex === planeIndex);
  }

  protected planeColumnIndex(column: WorkspaceColumn): number {
    return Math.max(
      0,
      this.columnsInPlane(column.planeIndex).findIndex(
        (candidate) => candidate.columnId === column.columnId,
      ),
    );
  }

  protected planeIndexes(): number[] {
    return planeIndexesForColumns(this.columns);
  }

  protected reindexColumns(): void {
    this.columns = this.columns
      .toSorted(compareColumnsByPlaneAndSlot)
      .map((column, index) => ({
        ...column,
        index,
        slotIndex: columnSlotIndex(column),
      }));
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

  resizeColumn(columnId: ColumnId, width: ColumnWidthSpec): void {
    const column = this.requireColumn(columnId);
    this.resizeColumnsInSlot(columnSlotIndex(column), width);
  }

  resetColumnWidth(columnId: ColumnId): void {
    const column = this.requireColumn(columnId);
    this.resizeColumnsInSlot(
      columnSlotIndex(column),
      column.idealWidthSpec,
      false,
    );
  }

  resizePane(paneId: PaneId, heightPx: number | null): void {
    const sizing = this.cellSizingForPane(paneId);
    if (!sizing) {
      return;
    }
    const nextHeightPx = normalizedPaneHeightPx(heightPx);
    this.setCellSizingForPane(paneId, {
      ...sizing,
      ...(nextHeightPx === null
        ? { heightPx: undefined }
        : { heightPx: nextHeightPx }),
    });
  }

  resizeColumnRows(
    columnId: ColumnId,
    heights: readonly (number | null)[],
  ): boolean {
    const column = this.requireColumn(columnId);
    if (heights.length !== column.cells.length) {
      return false;
    }
    column.cells = column.cells.map((cell, index) => {
      const heightPx = normalizedPaneHeightPx(heights[index] ?? null);
      const { heightPx: _previousHeightPx, ...cellWithoutHeight } = cell;
      return {
        ...(heightPx === null ? cellWithoutHeight : { ...cell, heightPx }),
        weight: cell.weight,
      };
    });
    return true;
  }

  resizePaneSplit(
    upperPaneId: PaneId,
    lowerPaneId: PaneId,
    upperHeightWeight: number,
    lowerHeightWeight: number,
    viewport: Rect,
  ): boolean {
    const upperLocation = this.locationForPane(upperPaneId);
    const lowerLocation = this.locationForPane(lowerPaneId);
    if (!locationsFormAdjacentSplit(upperLocation, lowerLocation)) {
      return false;
    }
    const upperSizing = this.cellSizingForPane(upperPaneId);
    const lowerSizing = this.cellSizingForPane(lowerPaneId);
    if (!upperSizing || !lowerSizing) {
      return false;
    }
    const upperWeight = normalizedPaneWeight(upperHeightWeight);
    const lowerWeight = normalizedPaneWeight(lowerHeightWeight);
    const upperDefaults = resolvePaneDefaults(
      this.paneById.get(upperPaneId) ?? null,
      this.scene,
    );
    const lowerDefaults = resolvePaneDefaults(
      this.paneById.get(lowerPaneId) ?? null,
      this.scene,
    );
    const configured = [upperDefaults, lowerDefaults].some(
      (defaults) =>
        defaults.height !== undefined ||
        defaults.aspectRatio !== undefined ||
        defaults.minHeight !== undefined ||
        defaults.maxHeight !== undefined,
    );
    if (configured) {
      const boxes = this.resolvePaneWorldBoxes(viewport);
      const upper = boxes.find((box) => box.paneId === upperPaneId)!;
      const lower = boxes.find((box) => box.paneId === lowerPaneId)!;
      const heights = constrainSplitHeights({
        total: upper.height + lower.height,
        upperWeight,
        lowerWeight,
        upper: upperDefaults,
        lower: lowerDefaults,
        availableHeight: this.availablePaneHeight(viewport.height),
      });
      const pairWeight = upperWeight + lowerWeight;
      const pairHeight = heights[0] + heights[1];
      this.setCellSizingForPane(upperPaneId, {
        heightPx: heights[0],
        weight: (pairWeight * heights[0]) / pairHeight,
      });
      this.setCellSizingForPane(lowerPaneId, {
        heightPx: heights[1],
        weight: (pairWeight * heights[1]) / pairHeight,
      });
      return true;
    }
    const [resizedUpperSizing, resizedLowerSizing] = resizedSplitSizing(
      upperSizing,
      lowerSizing,
      upperWeight,
      lowerWeight,
    );
    this.setCellSizingForPane(upperPaneId, resizedUpperSizing);
    this.setCellSizingForPane(lowerPaneId, resizedLowerSizing);
    return true;
  }

  toScene(id: string = this.scene.id): WorkspaceScene {
    const columns = this.columns.map((column, index) => ({
      ...column,
      cells: column.cells.map(cloneWorkspaceCell),
      idealWidthSpec: { ...column.idealWidthSpec },
      index,
      slotIndex: columnSlotIndex(column),
      widthSpec: { ...column.widthSpec },
    }));
    const panes = [...this.paneById.values()].sort(
      (left, right) => left.sequence - right.sequence,
    );
    const planeColumnCounts = new Map<number, number>();
    for (const column of this.columns)
      planeColumnCounts.set(
        column.planeIndex,
        (planeColumnCounts.get(column.planeIndex) ?? 0) + 1,
      );
    const widestPlaneColumnCount = Math.max(1, ...planeColumnCounts.values());
    return {
      ...this.scene,
      columns,
      id,
      paneById: new Map(panes.map((pane) => [pane.paneId, pane])),
      panes,
      panesPerColumn: Math.max(
        1,
        ...columns.map((column) => occupiedPaneCount(column.cells)),
      ),
      totalPanes: panes.length,
      visibleColumnCount: Math.min(
        this.scene.visibleColumnCount,
        widestPlaneColumnCount,
      ),
    };
  }
}

function columnHasStructure(column: WorkspaceColumn): boolean {
  return column.cells.some((cell) => cell.paneId !== null || cell.reserved);
}

function cloneWorkspaceCell(cell: WorkspaceCell): WorkspaceCell {
  return {
    ...(cell.heightPx === undefined ? {} : { heightPx: cell.heightPx }),
    paneId: cell.paneId,
    reserved: cell.reserved,
    weight: cell.weight,
  };
}

function occupiedPaneCount(cells: readonly WorkspaceCell[]): number {
  return cells.filter((cell) => cell.paneId !== null).length;
}

function defaultCellSizing() {
  return { weight: 1 };
}

function defaultWorkspaceCell(): WorkspaceCell {
  return { paneId: null, reserved: false, weight: 1 };
}

function cellSizingForCell(cell: WorkspaceCell) {
  return cell.heightPx === undefined
    ? { weight: cell.weight }
    : { heightPx: cell.heightPx, weight: cell.weight };
}

const maximumCompactPanePeekPx = 32;

function normalizedCompactPanePeek(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, maximumCompactPanePeekPx) : 0;
}
