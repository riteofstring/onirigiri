import { columnSlotIndex } from "./column-slots.js";
import { WorkspaceLayoutEngineBase } from "./layout-engine-base.js";
import {
  clamp,
  gridColumnRangeAt,
  gridRowRangeAt,
  isHorizontalDirection,
  paneCellsForColumn,
  paneHeightsForColumn,
  type ColumnGeometry,
  type GridRowGeometry,
  type PaneDirection,
  type PaneLocation,
  scrollOffsetForGridColumn,
  scrollOffsetForGridRow,
} from "./layout-engine-helpers.js";
import {
  normalizedPaneWeight,
  paneSurfaceForRequest,
} from "./layout-engine-normalization.js";
import {
  emptyPaneMoveCell,
  finiteFrameValue,
  isOrdinaryOccupiedCell,
  placementToDirection,
} from "./layout-engine-rearrangement-helpers.js";
import {
  overviewLayoutGeometry,
  renderNormalLayoutFrame,
} from "./layout-engine-rendering.js";
import {
  nextWorkspaceGridCursor,
  normalizeWorkspaceGridCursor,
  workspaceGridCursorForPane,
} from "../workspace/workspace-grid-cursor.js";
import type {
  ColumnId,
  LayoutEngine,
  LayoutFrameInput,
  OpenPaneRequest,
  PaneId,
  PaneInsertionPlacement,
  PaneMoveDirection,
  PaneRenderItem,
  PaneWorldBox,
  Rect,
  ReservedCellRenderItem,
  WorkspaceColumn,
  WorkspaceCell,
  WorkspaceGridCameraTarget,
  WorkspaceGridCellBox,
  WorkspaceGridCursor,
  WorkspaceGridCursorRenderItem,
  WorkspaceGridOrigin,
  WorkspaceFocusAnchor,
  WorkspacePane,
  WorkspaceScene,
} from "../types.js";

interface PaneSplitInsertion {
  sourceCell: WorkspaceCell;
  sourceColumn: WorkspaceColumn;
  targetCell: WorkspaceCell & { paneId: PaneId; reserved: false };
  targetColumn: WorkspaceColumn;
}

interface PaneMoveContext {
  sourceCell: WorkspaceCell;
  sourceColumn: WorkspaceColumn;
  targetCursor: WorkspaceGridCursor;
}

export class WorkspaceLikeLayoutEngine
  extends WorkspaceLayoutEngineBase
  implements LayoutEngine
{
  gridGeometryOrigin(cursor: WorkspaceGridCursor): WorkspaceGridOrigin {
    return floatingGridOrigin(cursor);
  }

  forkForWorldGeometry(scene: WorkspaceScene): WorkspaceLikeLayoutEngine {
    const fork = new WorkspaceLikeLayoutEngine(scene, this.options);
    fork.setCompactLayout(this.compactLayout, this.compactPanePeekPx);
    return fork;
  }

  closePane(paneId: PaneId): void {
    this.paneById.delete(paneId);
    this.columns = this.columns.map((column) => ({
      ...column,
      cells: column.cells.map((cell) =>
        cell.paneId === paneId
          ? { ...cell, paneId: null, reserved: false }
          : cell,
      ),
    }));
    for (const column of this.columns) {
      this.normalizeTransientCells(column);
    }
    this.removeEmptyColumns();
  }
  paneCount(): number {
    return this.paneById.size;
  }
  paneLocation(paneId: PaneId): PaneLocation | null {
    return this.locationForPane(paneId);
  }

  movePane(paneId: PaneId, direction: PaneMoveDirection): boolean {
    const context = this.paneMoveContext(paneId, direction);
    if (!context) {
      return false;
    }
    const { sourceCell, sourceColumn, targetCursor } = context;
    const targetColumn =
      this.columns.find(
        (column) =>
          column.planeIndex === targetCursor.row &&
          columnSlotIndex(column) === targetCursor.column,
      ) ??
      this.materializePaneMoveDestination(
        targetCursor,
        sourceColumn,
        sourceCell,
      );
    return this.movePaneToCell(
      paneId,
      sourceColumn.columnId,
      targetColumn,
      targetCursor.split,
    );
  }

  private paneMoveContext(
    paneId: PaneId,
    direction: PaneMoveDirection,
  ): PaneMoveContext | null {
    const scene = this.toScene();
    const sourceCursor = workspaceGridCursorForPane(scene, paneId);
    if (!sourceCursor) {
      return null;
    }
    const targetCursor = nextWorkspaceGridCursor({
      cursor: sourceCursor,
      direction,
      scene,
    });
    if (!targetCursor) {
      return null;
    }
    const source = this.locationForPane(paneId);
    if (!source) {
      return null;
    }
    const sourceColumn = this.columns[source.columnIndex];
    const sourceCell = sourceColumn?.cells[source.rowIndex];
    if (!sourceColumn || !sourceCell) {
      return null;
    }
    return { sourceCell, sourceColumn, targetCursor };
  }

  private movePaneToCell(
    paneId: PaneId,
    sourceColumnId: ColumnId,
    targetColumn: WorkspaceColumn,
    targetRowIndex: number,
  ): boolean {
    const currentSourceColumn = this.requireColumn(sourceColumnId);
    const currentSourceRowIndex = currentSourceColumn.cells.findIndex(
      (cell) => cell.paneId === paneId,
    );
    if (currentSourceRowIndex < 0) {
      return false;
    }
    const targetCell = targetColumn.cells[targetRowIndex];
    const currentSourceCell = currentSourceColumn.cells[currentSourceRowIndex];
    if (!currentSourceCell || !targetCell) {
      return false;
    }
    const targetPaneId = targetCell.paneId;
    if (targetPaneId) {
      currentSourceCell.paneId = targetPaneId;
      targetCell.paneId = paneId;
      this.movePaneStateToColumn(paneId, targetColumn.columnId);
      this.movePaneStateToColumn(targetPaneId, currentSourceColumn.columnId);
      return true;
    }

    currentSourceCell.paneId = null;
    currentSourceCell.reserved = false;
    targetCell.paneId = paneId;
    targetCell.reserved = false;
    this.movePaneStateToColumn(paneId, targetColumn.columnId);
    this.normalizeTransientCells(currentSourceColumn);
    this.removeEmptyColumns();
    return true;
  }

  private materializePaneMoveDestination(
    cursor: WorkspaceGridCursor,
    sourceColumn: WorkspaceColumn,
    sourceCell: WorkspaceCell,
  ): WorkspaceColumn {
    const column: WorkspaceColumn = {
      cells: [emptyPaneMoveCell(sourceCell)],
      columnId: this.nextColumnId(),
      idealWidthSpec: { ...sourceColumn.idealWidthSpec },
      index: this.columns.length,
      planeIndex: cursor.row,
      ...(sourceColumn.previousProportionWidth === undefined
        ? {}
        : { previousProportionWidth: sourceColumn.previousProportionWidth }),
      slotIndex: cursor.column,
      widthSpec: { ...sourceColumn.widthSpec },
      ...(sourceColumn.widthOverride === undefined
        ? {}
        : { widthOverride: sourceColumn.widthOverride }),
    };
    this.columns.push(column);
    this.reindexColumns();
    return this.requireColumn(column.columnId);
  }

  createReservedBlankSplit(paneId: PaneId, direction: "up" | "down"): boolean {
    const source = this.locationForPane(paneId);
    const column = source ? this.columns[source.columnIndex] : undefined;
    const sourceCell = source ? column?.cells[source.rowIndex] : undefined;
    if (!source || !column || !sourceCell) {
      return false;
    }
    const splitWeight = sourceCell.weight;
    column.cells[source.rowIndex] = {
      paneId,
      reserved: false,
      weight: splitWeight,
    };
    column.cells.splice(source.rowIndex + (direction === "down" ? 1 : 0), 0, {
      paneId: null,
      reserved: true,
      weight: splitWeight,
    });
    return true;
  }

  insertPaneAsSplit(paneId: PaneId, direction: "left" | "right"): boolean {
    const insertion = this.paneSplitInsertion(paneId, direction);
    if (!insertion) {
      return false;
    }
    insertion.sourceCell.paneId = null;
    insertion.sourceCell.reserved = false;
    const splitCells: WorkspaceCell[] = [
      {
        paneId: insertion.targetCell.paneId,
        reserved: false,
        weight: insertion.targetCell.weight,
      },
      { paneId, reserved: false, weight: insertion.targetCell.weight },
    ];
    insertion.targetColumn.cells =
      direction === "left" ? splitCells.toReversed() : splitCells;
    this.movePaneStateToColumn(paneId, insertion.targetColumn.columnId);
    this.normalizeTransientCells(insertion.sourceColumn);
    this.removeEmptyColumns();
    return true;
  }

  private paneSplitInsertion(
    paneId: PaneId,
    direction: "left" | "right",
  ): PaneSplitInsertion | null {
    const source = this.locationForPane(paneId);
    const sourceColumn = source ? this.columns[source.columnIndex] : undefined;
    if (!source || !sourceColumn) {
      return null;
    }
    const targetColumn = this.columnsInPlane(source.planeIndex).find(
      (column) =>
        columnSlotIndex(column) ===
        columnSlotIndex(sourceColumn) + (direction === "left" ? -1 : 1),
    );
    const targetCell = targetColumn?.cells[0];
    const sourceCell = sourceColumn.cells[source.rowIndex];
    if (
      !sourceCell ||
      !targetColumn ||
      targetColumn.cells.length !== 1 ||
      !isOrdinaryOccupiedCell(targetCell)
    ) {
      return null;
    }
    return { sourceCell, sourceColumn, targetCell, targetColumn };
  }

  movePaneGroup(paneId: PaneId, direction: PaneMoveDirection): boolean {
    const source = this.locationForPane(paneId);
    const sourceColumn = source ? this.columns[source.columnIndex] : undefined;
    if (!source || !sourceColumn) {
      return false;
    }
    const targetColumn = this.adjacentGroupColumn(
      source,
      direction,
      sourceColumn,
    );
    const currentSource = this.requireColumn(sourceColumn.columnId);
    const currentTarget = this.requireColumn(targetColumn.columnId);
    if (currentSource.columnId === currentTarget.columnId) {
      return false;
    }
    [currentSource.cells, currentTarget.cells] = [
      currentTarget.cells,
      currentSource.cells,
    ];
    this.movePaneCellsToColumn(currentSource.cells, currentSource.columnId);
    this.movePaneCellsToColumn(currentTarget.cells, currentTarget.columnId);
    this.removeEmptyColumns();
    return true;
  }

  removeReservedBlankSplit(paneId: PaneId, direction: "up" | "down"): boolean {
    const source = this.locationForPane(paneId);
    const column = source ? this.columns[source.columnIndex] : undefined;
    if (!source || !column) {
      return false;
    }
    const targetIndex = source.rowIndex + (direction === "up" ? -1 : 1);
    const targetCell = column.cells[targetIndex];
    if (!targetCell?.reserved || targetCell.paneId !== null) {
      return false;
    }
    column.cells.splice(targetIndex, 1);
    this.normalizeTransientCells(column);
    return true;
  }

  private adjacentGroupColumn(
    source: PaneLocation,
    direction: PaneMoveDirection,
    sourceColumn: WorkspaceColumn,
  ): WorkspaceColumn {
    const sourceSlotIndex = columnSlotIndex(sourceColumn);
    const horizontal = isHorizontalDirection(direction);
    const step = direction === "left" || direction === "up" ? -1 : 1;
    const planeIndex = source.planeIndex + (horizontal ? 0 : step);
    const slotIndex = sourceSlotIndex + (horizontal ? step : 0);
    return (
      this.columnsInPlane(planeIndex).find(
        (column) => columnSlotIndex(column) === slotIndex,
      ) ??
      this.insertColumnInPlaneSlot(
        planeIndex,
        slotIndex,
        sourceColumn.widthSpec,
      )
    );
  }

  private movePaneCellsToColumn(
    cells: readonly WorkspaceCell[],
    columnId: ColumnId,
  ): void {
    for (const cell of cells) {
      if (cell.paneId) {
        this.movePaneStateToColumn(cell.paneId, columnId);
      }
    }
  }

  openPane(request: OpenPaneRequest): PaneId {
    const paneSurface = paneSurfaceForRequest(request);
    const targetColumn = request.columnId
      ? this.requireColumn(request.columnId)
      : this.insertColumnAfter(request.adjacentToColumnId, request.widthSpec);
    if (request.widthSpec) {
      targetColumn.widthSpec = { ...request.widthSpec };
      targetColumn.idealWidthSpec = { ...request.widthSpec };
      targetColumn.widthOverride = true;
    }
    const sequence = this.nextPaneSequence;
    this.nextPaneSequence += 1;
    const surfaceSequence = this.nextSurfaceSequence;
    this.nextSurfaceSequence += 1;
    const pane: WorkspacePane = {
      columnId: targetColumn.columnId,
      paneId: `workspace_pane_${sequence}`,
      sequence,
      subtitle: request.subtitle ?? "workspace surface",
      surfaceId: `workspace_surface_${surfaceSequence}`,
      title: request.title ?? `Pane ${String(sequence + 1).padStart(3, "0")}`,
      tone: request.tone ?? "slate",
      ...paneSurface,
    };
    this.paneById.set(pane.paneId, pane);
    this.appendPaneCell(targetColumn, pane.paneId, {
      weight: normalizedPaneWeight(request.weight ?? 1),
    });
    return pane.paneId;
  }

  openPaneNearPane(
    paneId: PaneId,
    placement: PaneInsertionPlacement,
    request: OpenPaneRequest,
  ): PaneId {
    paneSurfaceForRequest(request);
    const source = this.locationForPane(paneId);
    if (!source) {
      return this.openPane(request);
    }
    if (placement === "right") {
      const columnId = this.insertAdjacentColumn(
        source,
        "right",
        request.widthSpec,
      ).columnId;
      return this.openPane({ ...request, columnId });
    }
    const sourceColumn = this.columns[source.columnIndex];
    const widthSpec = request.widthSpec ?? sourceColumn?.widthSpec;
    const targetPlaneIndex = this.insertPlaneBeside(
      source.planeIndex,
      placementToDirection(placement),
    );
    const columnId = this.insertColumnInPlaneSlot(
      targetPlaneIndex,
      sourceColumn ? columnSlotIndex(sourceColumn) : source.planeColumnIndex,
      widthSpec,
    ).columnId;
    return this.openPane({ ...request, columnId });
  }

  configurePane(paneId: PaneId, request: OpenPaneRequest): PaneId {
    const pane = this.paneById.get(paneId);
    if (!pane) {
      throw new Error(`unknown workspace pane ${paneId}`);
    }
    const paneSurface = paneSurfaceForRequest(request, pane);
    const surfaceSequence = this.nextSurfaceSequence;
    this.nextSurfaceSequence += 1;
    const sizing = this.cellSizingForPane(paneId);
    if (!sizing) {
      throw new Error(`unknown workspace pane sizing ${paneId}`);
    }
    this.paneById.set(paneId, {
      columnId: pane.columnId,
      paneId: pane.paneId,
      sequence: pane.sequence,
      subtitle: request.subtitle ?? pane.subtitle,
      surfaceId: `workspace_surface_${surfaceSequence}`,
      title: request.title ?? pane.title,
      tone: request.tone ?? pane.tone,
      ...paneSurface,
    });
    this.setCellSizingForPane(paneId, {
      ...sizing,
      weight: normalizedPaneWeight(request.weight ?? sizing.weight),
    });
    return paneId;
  }

  renderFrame(
    input: LayoutFrameInput,
    push: (item: PaneRenderItem) => void,
  ): void {
    if (
      this.columns.length === 0 ||
      input.viewport.width <= 0 ||
      input.viewport.height <= 0
    ) {
      return;
    }

    if (input.presentationMode === "overview") {
      this.renderOverviewFrame(input, push);
    } else {
      this.renderNormalFrame(input, push);
    }
  }

  reservedCellRenderItems(input: LayoutFrameInput): ReservedCellRenderItem[] {
    const items: ReservedCellRenderItem[] = [];
    if (
      !this.columns.some((column) =>
        column.cells.some((cell) => cell.paneId === null && cell.reserved),
      ) ||
      input.viewport.width <= 0 ||
      input.viewport.height <= 0
    ) {
      return items;
    }
    const push = () => undefined;
    if (input.presentationMode === "overview") {
      this.renderOverviewFrame(input, push, (item) => items.push(item));
    } else {
      this.renderNormalFrame(input, push, (item) => items.push(item));
    }
    return items;
  }

  gridCellBox(
    cursor: WorkspaceGridCursor,
    viewport: Rect,
    maximizedPaneId: PaneId | null = null,
    origin?: WorkspaceGridOrigin,
  ): WorkspaceGridCellBox {
    const normalizedCursor = normalizeWorkspaceGridCursor(
      { columns: this.columns },
      cursor,
    );
    const geometryOrigin = origin ?? this.gridGeometryOrigin(normalizedCursor);
    const geometry = this.columnGeometry(
      viewport,
      maximizedPaneId,
      this.scene.columnGap,
      this.options.allowResizedPanesToOverflowViewport ?? false,
      gridColumnRangeAt(geometryOrigin.column),
    );
    return this.gridCellBoxForGeometry({
      cursor: normalizedCursor,
      geometry,
      inlineOffset: this.compactInlinePadding(viewport.width),
      maximizedPaneId,
      rowGeometry: this.normalGridRowGeometry(
        viewport,
        maximizedPaneId,
        geometry,
        gridRowRangeAt(geometryOrigin.row),
      ),
      viewport,
    });
  }

  paneWorldBoxes(
    viewport: Rect,
    maximizedPaneId: PaneId | null = null,
    origin?: WorkspaceGridOrigin,
  ): readonly PaneWorldBox[] {
    return this.resolvePaneWorldBoxes(viewport, maximizedPaneId, origin);
  }

  gridCursorRenderItem(input: LayoutFrameInput): WorkspaceGridCursorRenderItem {
    const cursor = normalizeWorkspaceGridCursor(
      { columns: this.columns },
      input.cursor ?? { column: 0, row: 0, split: 0 },
    );
    if (input.presentationMode === "overview") {
      return this.overviewGridCursorRenderItem(cursor, input);
    }
    const geometry = this.columnGeometry(
      input.viewport,
      input.maximizedPaneId,
      this.scene.columnGap,
      this.options.allowResizedPanesToOverflowViewport ?? false,
      gridColumnRangeAt(Math.floor(input.scrollColumn)),
    );
    const rowGeometry = this.normalGridRowGeometry(
      input.viewport,
      input.maximizedPaneId,
      geometry,
      gridRowRangeAt(Math.floor(input.scrollRow)),
    );
    const cell = this.gridCellBoxForGeometry({
      cursor,
      geometry,
      inlineOffset: this.compactInlinePadding(input.viewport.width),
      maximizedPaneId: input.maximizedPaneId,
      rowGeometry,
      viewport: input.viewport,
    });
    const scrollColumn = input.scrollColumn;
    const horizontalPan =
      scrollOffsetForGridColumn(scrollColumn, geometry) +
      finiteFrameValue(input.horizontalAnchorOffset);
    const verticalPan =
      scrollOffsetForGridRow(input.scrollRow, rowGeometry) +
      finiteFrameValue(input.verticalAnchorOffset);
    return {
      cursor: cell.cursor,
      height: cell.height,
      kind: cell.kind,
      paneId: cell.paneId,
      presentationMode: input.presentationMode,
      scale: 1,
      structural: cell.structural,
      width: cell.width,
      x: input.viewport.x + cell.x - horizontalPan,
      y: cell.y - verticalPan,
    };
  }

  gridCameraTarget(
    cursor: WorkspaceGridCursor,
    viewport: Rect,
    focusAnchor: WorkspaceFocusAnchor,
    maximizedPaneId: PaneId | null = null,
  ): WorkspaceGridCameraTarget {
    const normalizedCursor = normalizeWorkspaceGridCursor(
      { columns: this.columns },
      cursor,
    );
    const columnGeometry = this.columnGeometry(
      viewport,
      maximizedPaneId,
      this.scene.columnGap,
      this.options.allowResizedPanesToOverflowViewport ?? false,
      gridColumnRangeAt(normalizedCursor.column),
    );
    const rowGeometry = this.normalGridRowGeometry(
      viewport,
      maximizedPaneId,
      columnGeometry,
      gridRowRangeAt(normalizedCursor.row),
    );
    const box = this.gridCellBoxForGeometry({
      cursor: normalizedCursor,
      geometry: columnGeometry,
      inlineOffset: this.compactInlinePadding(viewport.width),
      maximizedPaneId,
      rowGeometry,
      viewport,
    });
    const scrollColumn = normalizedCursor.column;
    const horizontalAnchorOffset =
      focusAnchor === "center"
        ? box.x +
          box.width / 2 -
          viewport.width / 2 -
          scrollOffsetForGridColumn(scrollColumn, columnGeometry)
        : 0;
    const verticalAnchorOffset =
      focusAnchor === "center"
        ? box.y + box.height / 2 - viewport.height / 2
        : this.compactLayout
          ? box.y - this.renderScene().padding
          : 0;
    return {
      horizontalAnchorOffset,
      scrollColumn,
      scrollRow: normalizedCursor.row,
      verticalAnchorOffset,
    };
  }

  renamePane(paneId: PaneId, title: string): boolean {
    const pane = this.paneById.get(paneId);
    const normalizedTitle = title.trim();
    if (
      !pane ||
      normalizedTitle.length === 0 ||
      pane.title === normalizedTitle
    ) {
      return false;
    }
    this.paneById.set(paneId, {
      ...pane,
      title: normalizedTitle,
    });
    return true;
  }

  private overviewGridCursorRenderItem(
    cursor: WorkspaceGridCursor,
    input: LayoutFrameInput,
  ): WorkspaceGridCursorRenderItem {
    const context = this.overviewLayoutContext({ ...input, cursor });
    const metrics = overviewLayoutGeometry(context);
    const cell = this.gridCellBoxForGeometry({
      cursor,
      geometry: context.geometry,
      inlineOffset: 0,
      maximizedPaneId: input.maximizedPaneId,
      rowGeometry: metrics.planeGeometry,
      viewport: input.viewport,
    });
    const xOffset =
      metrics.baseXOffset -
      clamp(finiteFrameValue(input.overviewPanX), 0, metrics.maxPanX) +
      finiteFrameValue(input.overviewFollowOffsetX);
    const yOffset =
      metrics.baseYOffset -
      clamp(finiteFrameValue(input.overviewPanY), 0, metrics.maxPanY) +
      finiteFrameValue(input.overviewFollowOffsetY);
    return {
      cursor: cell.cursor,
      height: cell.height,
      kind: cell.kind,
      paneId: cell.paneId,
      presentationMode: input.presentationMode,
      scale: metrics.scale,
      structural: cell.structural,
      width: cell.width,
      x: xOffset + cell.x * metrics.scale,
      y: yOffset + cell.y * metrics.scale,
    };
  }

  private gridCellBoxForGeometry({
    cursor,
    geometry,
    inlineOffset,
    maximizedPaneId,
    rowGeometry,
    viewport,
  }: {
    cursor: WorkspaceGridCursor;
    geometry: ColumnGeometry;
    inlineOffset: number;
    maximizedPaneId: PaneId | null;
    rowGeometry: GridRowGeometry;
    viewport: Rect;
  }): WorkspaceGridCellBox {
    const scene = this.renderScene();
    const column = this.columns.find(
      (candidate) =>
        candidate.planeIndex === cursor.row &&
        columnSlotIndex(candidate) === cursor.column,
    );
    const width = geometry.gridWidthForColumn(cursor.column);
    const x = inlineOffset + geometry.gridOffsetForColumn(cursor.column);
    const y = rowGeometry.gridOffsetForRow(cursor.row) + scene.padding;
    const logicalRowHeight = Math.max(
      1,
      rowGeometry.gridHeightForRow(cursor.row) - scene.padding * 2,
    );
    if (!column) {
      return {
        columnId: null,
        cursor,
        height: logicalRowHeight,
        kind: "empty",
        paneId: null,
        structural: false,
        width,
        x,
        y,
      };
    }
    const cells = paneCellsForColumn(column, this.paneById);
    const totalGap = scene.rowGap * Math.max(0, cells.length - 1);
    const heights = paneHeightsForColumn(
      cells,
      this.availablePaneHeight(viewport.height),
      totalGap,
      {
        fullSizePanes: this.compactLayout,
        maximizedPaneId,
        sizing: { configuration: scene, columnWidth: width },
      },
    );
    const cell = cells[cursor.split];
    const height = heights[cursor.split] ?? logicalRowHeight;
    const splitOffset = cells
      .slice(0, cursor.split)
      .reduce(
        (offset, _cell, index) => offset + (heights[index] ?? 0) + scene.rowGap,
        0,
      );
    const paneId = cell?.paneId ?? null;
    return {
      columnId: column.columnId,
      cursor,
      height,
      kind: paneId ? "occupied" : cell?.reserved ? "reserved" : "empty",
      paneId,
      structural: true,
      width,
      x,
      y: y + splitOffset,
    };
  }

  private renderNormalFrame(
    input: LayoutFrameInput,
    push: (item: PaneRenderItem) => void,
    pushReservedCell?: (item: ReservedCellRenderItem) => void,
  ): void {
    renderNormalLayoutFrame({
      availableHeight: this.availablePaneHeight(input.viewport.height),
      columns: this.columns,
      fullSizePanes: this.compactLayout,
      geometry: this.columnGeometry(
        input.viewport,
        input.maximizedPaneId,
        this.scene.columnGap,
        this.options.allowResizedPanesToOverflowViewport ?? false,
        gridColumnRangeAt(Math.floor(input.scrollColumn)),
      ),
      inlinePadding: this.compactInlinePadding(input.viewport.width),
      input,
      paneById: this.paneById,
      planeIndexes: this.planeIndexes(),
      push,
      pushReservedCell,
      scene: this.renderScene(),
    });
  }

  splitPane(paneId: PaneId, direction: PaneDirection, viewport?: Rect): PaneId {
    const source = this.locationForPane(paneId);
    if (!source) {
      return this.openPane({});
    }
    if (isHorizontalDirection(direction)) {
      const columnId = this.insertAdjacentColumn(source, direction).columnId;
      return this.openPane({ columnId });
    }
    const column = this.columns[source.columnIndex]!;
    const heights =
      viewport && this.options.keepHeightWhenSplitting
        ? this.fixFlexibleColumnHeights(column, viewport)
        : undefined;
    const createdPaneId = this.openPane({
      columnId: column.columnId,
    });
    this.insertPaneBesideSource(createdPaneId, source, direction);
    if (viewport && heights) {
      const [upper, lower] =
        direction === "up" ? [createdPaneId, paneId] : [paneId, createdPaneId];
      this.keepSplitWithinHeight(
        upper,
        lower,
        heights[source.rowIndex]!,
        viewport,
      );
    }
    return createdPaneId;
  }

  splitPaneToPlane(paneId: PaneId, direction: "up" | "down"): PaneId {
    const source = this.locationForPane(paneId);
    if (!source) {
      return this.openPane({});
    }
    const sourceColumn = this.columns[source.columnIndex];
    const targetPlaneIndex = this.insertPlaneBeside(
      source.planeIndex,
      direction,
    );
    const columnId = this.insertColumnInPlaneSlot(
      targetPlaneIndex,
      sourceColumn ? columnSlotIndex(sourceColumn) : source.planeColumnIndex,
      sourceColumn?.widthSpec,
    ).columnId;
    return this.openPane({ columnId });
  }
}

const floatingOriginChunkSize = 1_048_576;

function floatingGridOrigin(cursor: WorkspaceGridCursor): WorkspaceGridOrigin {
  return {
    column: floatingCoordinateOrigin(cursor.column),
    row: floatingCoordinateOrigin(cursor.row),
  };
}

function floatingCoordinateOrigin(coordinate: number): number {
  return (
    Math.trunc(coordinate / floatingOriginChunkSize) * floatingOriginChunkSize
  );
}
