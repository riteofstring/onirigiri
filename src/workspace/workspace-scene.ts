import {
  validatePaneDefaults,
  validatePaneDefaultsConfiguration,
} from "../layout/pane-defaults";
import { denselyReindexPlanes } from "../layout/layout-planes";
import {
  assertWorkspaceGridCursor,
  layoutOriginCursor,
  normalizeWorkspaceGridCursor,
} from "./workspace-grid-cursor";
import type {
  ColumnId,
  ColumnWidthSpec,
  PaneCellSizing,
  PaneDefaults,
  PaneDefaultsConfiguration,
  PaneId,
  PaneTone,
  SurfaceId,
  SurfaceKind,
  WorkspaceColumn,
  WorkspaceCell,
  WorkspaceGridAxes,
  WorkspaceGridCursor,
  WorkspacePane,
  WorkspaceScene,
} from "../types";
import { defaultWorkspaceGridAxes } from "../types";

const onirigiriLayoutSchemaVersion = 4;

const defaultColumnWidthSpec: ColumnWidthSpec = { unit: "px", value: 520 };
const defaultWorkspaceSceneOptions = {
  columnGap: 8,
  defaultColumnWidth: defaultColumnWidthSpec,
  id: "onirigiri-workspace",
  initialLayout: null,
  padding: 10,
  panes: [],
  renderOverscanColumns: 8,
  rowGap: 8,
  visibleColumnCount: 3,
} as const;

export interface OnirigiriPaneDefinition {
  defaults?: PaneDefaults;
  columnId?: ColumnId;
  columnWidth?: ColumnWidthSpec;
  data?: unknown;
  heightPx?: number;
  paneId: PaneId;
  planeIndex?: number;
  slotIndex?: number;
  subtitle?: string;
  surfaceId?: SurfaceId;
  surfaceKind: SurfaceKind;
  title: string;
  tone?: PaneTone;
  weight?: number;
}

export interface OnirigiriLayout {
  columns: WorkspaceColumn[];
  cursor: WorkspaceGridCursor;
  id: string;
  panes: WorkspacePane[];
  schemaVersion: number;
}

export interface WorkspaceSceneOptions extends PaneDefaultsConfiguration {
  columnGap?: number;
  defaultColumnWidth?: ColumnWidthSpec;
  gridAxes?: WorkspaceGridAxes;
  id?: string;
  initialLayout?: OnirigiriLayout | null;
  panes?: readonly OnirigiriPaneDefinition[];
  padding?: number;
  renderOverscanColumns?: number;
  rowGap?: number;
  visibleColumnCount?: number;
}

export interface WorkspaceSceneResult {
  cursor: WorkspaceGridCursor;
  scene: WorkspaceScene;
}

interface ResolvedWorkspaceSceneOptions {
  columnGap: number;
  defaultColumnWidth: ColumnWidthSpec;
  gridAxes: WorkspaceGridAxes;
  id: string;
  initialLayout: OnirigiriLayout | null;
  padding: number;
  panes: readonly OnirigiriPaneDefinition[];
  renderOverscanColumns: number;
  rowGap: number;
  visibleColumnCount: number;
}

export function createWorkspaceScene(
  options: WorkspaceSceneOptions = {},
): WorkspaceSceneResult {
  validatePaneDefaultsConfiguration(options);
  const resolved = resolveWorkspaceSceneOptions(options);
  if (resolved.initialLayout) {
    assertOnirigiriLayout(resolved.initialLayout);
  }
  const sourcePanes = sourcePanesForLayout(
    resolved.initialLayout,
    resolved.panes,
  );
  const normalizedPanes = panesOrDefault(sourcePanes);
  const sourceColumns = sourceColumnsForLayout(resolved, normalizedPanes);
  const scene = sceneFromPanesAndColumns({
    columnGap: resolved.columnGap,
    columns: sourceColumns,
    defaultColumnWidth: resolved.defaultColumnWidth,
    gridAxes: resolved.gridAxes,
    id: workspaceIdForLayout(resolved.initialLayout, resolved.id),
    padding: resolved.padding,
    panes: normalizedPanes,
    preserveGridCoordinates: resolved.initialLayout !== null,
    renderOverscanColumns: resolved.renderOverscanColumns,
    rowGap: resolved.rowGap,
    visibleColumnCount: resolved.visibleColumnCount,
  });
  scene.paneDefaults = options.paneDefaults;
  scene.paneTypeDefaults = options.paneTypeDefaults;
  return {
    cursor: normalizeWorkspaceGridCursor(
      scene,
      cursorForLayout(resolved.initialLayout),
    ),
    scene,
  };
}

function resolveWorkspaceSceneOptions(
  options: WorkspaceSceneOptions,
): ResolvedWorkspaceSceneOptions {
  return {
    columnGap: valueOrDefault(
      options.columnGap,
      defaultWorkspaceSceneOptions.columnGap,
    ),
    defaultColumnWidth: valueOrDefault(
      options.defaultColumnWidth,
      defaultWorkspaceSceneOptions.defaultColumnWidth,
    ),
    gridAxes: resolveWorkspaceGridAxes(options.gridAxes),
    id: valueOrDefault(options.id, defaultWorkspaceSceneOptions.id),
    initialLayout: valueOrDefault(
      options.initialLayout,
      defaultWorkspaceSceneOptions.initialLayout,
    ),
    padding: valueOrDefault(
      options.padding,
      defaultWorkspaceSceneOptions.padding,
    ),
    panes: valueOrDefault(options.panes, defaultWorkspaceSceneOptions.panes),
    renderOverscanColumns: valueOrDefault(
      options.renderOverscanColumns,
      defaultWorkspaceSceneOptions.renderOverscanColumns,
    ),
    rowGap: valueOrDefault(options.rowGap, defaultWorkspaceSceneOptions.rowGap),
    visibleColumnCount: valueOrDefault(
      options.visibleColumnCount,
      defaultWorkspaceSceneOptions.visibleColumnCount,
    ),
  };
}

function valueOrDefault<Value>(
  value: Value | undefined,
  fallback: Value,
): Value {
  return value === undefined ? fallback : value;
}

function resolveWorkspaceGridAxes(
  value: WorkspaceGridAxes | undefined,
): WorkspaceGridAxes {
  const axes = value ?? defaultWorkspaceGridAxes;
  if (axes !== "horizontal" && axes !== "spatial") {
    throw new Error("Onirigiri gridAxes must be horizontal or spatial");
  }
  return axes;
}

function sourcePanesForLayout(
  layout: OnirigiriLayout | null,
  definitions: readonly OnirigiriPaneDefinition[],
): WorkspacePane[] {
  if (layout && layout.panes.length > 0) {
    return layout.panes.map(clonePane);
  }
  return paneDefinitionsToPanes(definitions);
}

function panesOrDefault(panes: WorkspacePane[]): WorkspacePane[] {
  return panes.length > 0 ? panes : [defaultPane()];
}

function sourceColumnsForLayout(
  options: ResolvedWorkspaceSceneOptions,
  panes: readonly WorkspacePane[],
): WorkspaceColumn[] {
  if (options.initialLayout && options.initialLayout.columns.length > 0) {
    return options.initialLayout.columns.map(cloneColumn);
  }
  return columnsForDefinitions(
    panes,
    options.panes,
    options.defaultColumnWidth,
  );
}

function workspaceIdForLayout(
  layout: OnirigiriLayout | null,
  fallbackId: string,
): string {
  return layout?.id || fallbackId;
}

function cursorForLayout(layout: OnirigiriLayout | null): WorkspaceGridCursor {
  return layout?.cursor ?? { ...layoutOriginCursor };
}

export function serializeWorkspaceLayout(
  scene: WorkspaceScene,
  cursor: WorkspaceGridCursor,
): OnirigiriLayout {
  return {
    columns: scene.columns.map(cloneColumn),
    cursor: normalizeWorkspaceGridCursor(scene, cursor),
    id: scene.id,
    panes: scene.panes.map(clonePane),
    schemaVersion: onirigiriLayoutSchemaVersion,
  };
}

function paneDefinitionsToPanes(
  definitions: readonly OnirigiriPaneDefinition[],
): WorkspacePane[] {
  return definitions.map((definition, sequence) => {
    validatePaneDefaults(definition.defaults);
    const pane: WorkspacePane = {
      ...(definition.defaults ? { defaults: definition.defaults } : {}),
      columnId: definition.columnId ?? `workspace_column_${sequence}`,
      paneId: definition.paneId,
      sequence,
      subtitle: definition.subtitle ?? "",
      surfaceId: definition.surfaceId ?? `workspace_surface_${sequence}`,
      surfaceKind: definition.surfaceKind,
      title: definition.title,
      tone: definition.tone ?? "slate",
    };
    if (definition.data !== undefined) {
      pane.data = definition.data;
    }
    return pane;
  });
}

function columnsForDefinitions(
  panes: readonly WorkspacePane[],
  definitions: readonly OnirigiriPaneDefinition[],
  fallbackWidth: ColumnWidthSpec,
): WorkspaceColumn[] {
  const columns: WorkspaceColumn[] = [];
  const columnById = new Map<ColumnId, WorkspaceColumn>();
  for (const [paneIndex, pane] of panes.entries()) {
    const definition = definitions[paneIndex];
    let column = columnById.get(pane.columnId);
    if (!column) {
      const widthSpec = cloneWidthSpec(
        definition?.columnWidth ?? fallbackWidth,
      );
      column = {
        cells: [],
        columnId: pane.columnId,
        idealWidthSpec: cloneWidthSpec(widthSpec),
        index: columns.length,
        planeIndex: normalizedIndex(definition?.planeIndex, 0),
        slotIndex: normalizedIndex(definition?.slotIndex, columns.length),
        widthSpec,
        ...(definition?.columnWidth ? { widthOverride: true } : {}),
      };
      columns.push(column);
      columnById.set(column.columnId, column);
    }
    column.cells.push({
      ...cellSizingForDefinition(definition),
      paneId: pane.paneId,
      reserved: false,
    });
  }
  return columns;
}

function sceneFromPanesAndColumns({
  columnGap,
  columns,
  defaultColumnWidth,
  gridAxes,
  id,
  padding,
  panes,
  preserveGridCoordinates,
  renderOverscanColumns,
  rowGap,
  visibleColumnCount,
}: {
  columnGap: number;
  columns: readonly WorkspaceColumn[];
  defaultColumnWidth: ColumnWidthSpec;
  gridAxes: WorkspaceGridAxes;
  id: string;
  padding: number;
  panes: readonly WorkspacePane[];
  preserveGridCoordinates: boolean;
  renderOverscanColumns: number;
  rowGap: number;
  visibleColumnCount: number;
}): WorkspaceScene {
  const storedPanes = panes.map(clonePane);
  const storedPaneById = new Map(
    storedPanes.map((pane) => [pane.paneId, pane]),
  );
  const ownerColumnByPaneId = new Map<PaneId, ColumnId>();
  const ownedPaneIds = new Set<PaneId>();
  const usedSurfaceIds = new Set<SurfaceId>();
  const nextSlotIndexByPlane = new Map<number, number>();
  const structuralColumns = columns
    .map((column) => {
      const cells = column.cells.map((cell) => {
        if (cell.paneId) {
          if (
            !storedPaneById.has(cell.paneId) ||
            ownedPaneIds.has(cell.paneId)
          ) {
            throw new Error(
              `workspace column ${column.columnId} has an invalid pane cell`,
            );
          }
          ownedPaneIds.add(cell.paneId);
          ownerColumnByPaneId.set(cell.paneId, column.columnId);
        }
        return cloneWorkspaceCell(cell);
      });
      return {
        ...column,
        cells,
      };
    })
    .filter((column) => column.cells.length > 0)
    .map((column, index) => {
      const planeIndex = normalizedGridCoordinate(
        column.planeIndex,
        0,
        preserveGridCoordinates,
      );
      const fallbackSlotIndex = nextSlotIndexByPlane.get(planeIndex) ?? 0;
      const slotIndex = normalizedGridCoordinate(
        column.slotIndex,
        fallbackSlotIndex,
        preserveGridCoordinates,
      );
      nextSlotIndexByPlane.set(
        planeIndex,
        Math.max(fallbackSlotIndex, slotIndex) + 1,
      );
      return {
        ...cloneColumn(column),
        index,
        planeIndex,
        slotIndex,
      };
    });
  const normalizedColumns = preserveGridCoordinates
    ? structuralColumns
    : denselyReindexPlanes(structuralColumns);
  const normalizedPanes = storedPanes
    .filter((pane) => ownerColumnByPaneId.has(pane.paneId))
    .map((pane) => ({
      ...pane,
      columnId: ownerColumnByPaneId.get(pane.paneId) ?? pane.columnId,
      surfaceId: uniqueSurfaceId(pane, usedSurfaceIds),
    }));
  const boundedVisibleColumnCount = Math.max(1, Math.floor(visibleColumnCount));
  return {
    columnGap: Math.max(0, columnGap),
    columns: normalizedColumns,
    defaultColumnWidthSpec: cloneWidthSpec(defaultColumnWidth),
    gridAxes,
    id,
    paneById: new Map(normalizedPanes.map((pane) => [pane.paneId, pane])),
    panes: normalizedPanes,
    panesPerColumn: Math.max(1, ...normalizedColumns.map(occupiedPaneCount)),
    padding: Math.max(0, padding),
    renderOverscanColumns: Math.max(0, Math.floor(renderOverscanColumns)),
    rowGap: Math.max(0, rowGap),
    targetVisiblePanes: normalizedPanes.length,
    totalPanes: normalizedPanes.length,
    visibleColumnCount: Math.min(
      boundedVisibleColumnCount,
      Math.max(1, normalizedColumns.length),
    ),
  };
}

function defaultPane(): WorkspacePane {
  return {
    columnId: "workspace_column_0",
    paneId: "workspace_pane_0",
    sequence: 0,
    subtitle: "",
    surfaceId: "workspace_surface_0",
    surfaceKind: "empty-frame",
    title: "Empty pane",
    tone: "slate",
  };
}

function clonePane(pane: WorkspacePane): WorkspacePane {
  validatePaneDefaults(pane.defaults);
  return {
    ...pane,
    ...(pane.data === undefined ? {} : { data: pane.data }),
  };
}

function cloneColumn(column: WorkspaceColumn): WorkspaceColumn {
  return {
    ...column,
    cells: column.cells.map(cloneWorkspaceCell),
    idealWidthSpec: cloneWidthSpec(column.idealWidthSpec),
    widthSpec: cloneWidthSpec(column.widthSpec),
  };
}

function cloneWorkspaceCell(cell: WorkspaceCell): WorkspaceCell {
  return {
    ...(cell.heightPx === undefined ? {} : { heightPx: cell.heightPx }),
    paneId: cell.paneId,
    reserved: cell.reserved,
    weight: cell.weight,
  };
}

function cellSizingForDefinition(
  definition: OnirigiriPaneDefinition | undefined,
): PaneCellSizing {
  const heightPx = isFiniteNumber(definition?.heightPx)
    ? Math.max(96, Math.round(definition.heightPx))
    : undefined;
  return {
    ...(heightPx === undefined ? {} : { heightPx }),
    weight: normalizedWeight(definition?.weight),
  };
}

function cloneWidthSpec(spec: ColumnWidthSpec): ColumnWidthSpec {
  return { unit: spec.unit, value: spec.value };
}

function occupiedPaneCount(column: WorkspaceColumn): number {
  return column.cells.filter(
    (cell): cell is WorkspaceCell & { paneId: PaneId } => cell.paneId !== null,
  ).length;
}

export function assertOnirigiriLayout(layout: OnirigiriLayout): void {
  assertLayoutIdentity(layout);
  assertWorkspaceGridCursor(layout.cursor);
  const paneById = paneIndexForLayout(layout);
  const ownerByPaneId = paneOwnersForLayout(layout, paneById);
  assertLayoutPaneOwnership(layout, ownerByPaneId);
}

function assertLayoutIdentity(layout: OnirigiriLayout): void {
  if (layout.schemaVersion !== onirigiriLayoutSchemaVersion) {
    throw new Error(
      `unsupported Onirigiri layout schema ${String(layout.schemaVersion)}; expected ${String(onirigiriLayoutSchemaVersion)}`,
    );
  }
  if (!layout.id || layout.columns.length === 0) {
    throw new Error("Onirigiri layout is missing required workspace identity");
  }
}

function paneIndexForLayout(
  layout: OnirigiriLayout,
): Map<PaneId, WorkspacePane> {
  const paneById = new Map(layout.panes.map((pane) => [pane.paneId, pane]));
  if (paneById.size !== layout.panes.length) {
    throw new Error(
      "Onirigiri layout has duplicate or missing pane identities",
    );
  }
  return paneById;
}

function paneOwnersForLayout(
  layout: OnirigiriLayout,
  paneById: ReadonlyMap<PaneId, WorkspacePane>,
): Map<PaneId, ColumnId> {
  const columnIds = new Set<ColumnId>();
  const ownerByPaneId = new Map<PaneId, ColumnId>();
  for (const column of layout.columns) {
    assertLayoutColumnIdentity(column, columnIds);
    for (const cell of column.cells) {
      assertLayoutCellOwner(cell, column.columnId, paneById, ownerByPaneId);
    }
  }
  return ownerByPaneId;
}

function assertLayoutColumnIdentity(
  column: WorkspaceColumn,
  columnIds: Set<ColumnId>,
): void {
  if (
    !column.columnId ||
    columnIds.has(column.columnId) ||
    column.cells.length === 0 ||
    !Number.isSafeInteger(column.planeIndex) ||
    (column.slotIndex !== undefined && !Number.isSafeInteger(column.slotIndex))
  ) {
    throw new Error("Onirigiri layout has invalid column identities or cells");
  }
  columnIds.add(column.columnId);
}

function assertLayoutCellOwner(
  cell: WorkspaceCell,
  columnId: ColumnId,
  paneById: ReadonlyMap<PaneId, WorkspacePane>,
  ownerByPaneId: Map<PaneId, ColumnId>,
): void {
  if (!isValidWorkspaceCell(cell)) {
    throw new Error(`Onirigiri layout has an invalid cell in ${columnId}`);
  }
  if (cell.paneId === null) {
    return;
  }
  if (!paneById.has(cell.paneId) || ownerByPaneId.has(cell.paneId)) {
    throw new Error("Onirigiri layout has invalid pane ownership");
  }
  ownerByPaneId.set(cell.paneId, columnId);
}

function assertLayoutPaneOwnership(
  layout: OnirigiriLayout,
  ownerByPaneId: ReadonlyMap<PaneId, ColumnId>,
): void {
  if (
    ownerByPaneId.size !== layout.panes.length ||
    layout.panes.some(
      (pane) => ownerByPaneId.get(pane.paneId) !== pane.columnId,
    )
  ) {
    throw new Error("Onirigiri layout pane ownership does not match its cells");
  }
}

function isValidWorkspaceCell(cell: WorkspaceCell): boolean {
  return hasValidCellSizing(cell) && hasValidCellReservation(cell);
}

function hasValidCellSizing(cell: WorkspaceCell): boolean {
  return (
    isPositiveFiniteNumber(cell.weight) &&
    (cell.heightPx === undefined || isPositiveFiniteNumber(cell.heightPx))
  );
}

function hasValidCellReservation(cell: WorkspaceCell): boolean {
  return (
    typeof cell.reserved === "boolean" &&
    (cell.paneId === null || typeof cell.paneId === "string") &&
    !(cell.paneId !== null && cell.reserved)
  );
}

function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function uniqueSurfaceId(
  pane: WorkspacePane,
  usedSurfaceIds: Set<SurfaceId>,
): SurfaceId {
  if (!usedSurfaceIds.has(pane.surfaceId)) {
    usedSurfaceIds.add(pane.surfaceId);
    return pane.surfaceId;
  }
  const base = `${pane.surfaceId}_${pane.paneId}`;
  let candidate = base;
  let suffix = 1;
  while (usedSurfaceIds.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  usedSurfaceIds.add(candidate);
  return candidate;
}

function normalizedIndex(value: number | undefined, fallback: number): number {
  return isFiniteNumber(value)
    ? Math.max(0, Math.floor(value))
    : Math.max(0, fallback);
}

function normalizedGridCoordinate(
  value: number | undefined,
  fallback: number,
  preserveGridCoordinates: boolean,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized)) {
    throw new Error("workspace grid coordinates must be safe integers");
  }
  return preserveGridCoordinates ? normalized : Math.max(0, normalized);
}

function normalizedWeight(value: number | undefined): number {
  return isFiniteNumber(value) ? Math.max(0.1, value) : 1;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
