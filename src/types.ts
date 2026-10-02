export type PaneId = string;
export type PaneCell = PaneId | null;
export type ColumnId = string;
export type SurfaceId = string;
export type SurfaceKind = string;
export type PaneTone = "cyan" | "green" | "orange" | "pink" | "slate";

export type WorkspacePresentationMode = "normal" | "overview";
export type WorkspaceFocusAnchor = "start" | "center";
export type WorkspaceDirectionControlMode =
  "focus" | "move-pane" | "move-group";
export type WorkspaceCameraMode = "fixed" | "follow";
export type WorkspaceCameraModes = Readonly<
  Record<WorkspacePresentationMode, WorkspaceCameraMode>
>;
export const defaultWorkspaceCameraModes: WorkspaceCameraModes = Object.freeze({
  normal: "follow",
  overview: "follow",
});
export type OnirigiriEasing = (progress: number) => number;
export type OnirigiriMotionCurve =
  { durationMs: number; easing?: OnirigiriEasing } | { timeConstantMs: number };
export interface OnirigiriCameraMotion {
  navigation?: OnirigiriMotionCurve;
  overview?: OnirigiriMotionCurve;
  zoom?: OnirigiriMotionCurve;
}
export type OnirigiriFocusHighlightMotion = "camera" | OnirigiriMotionCurve;
export interface OnirigiriFocusHighlightOptions {
  motion?: OnirigiriFocusHighlightMotion;
}
export type WorkspaceGridAxes = "horizontal" | "spatial";
export const defaultWorkspaceGridAxes: WorkspaceGridAxes = "spatial";
export type PaneRearrangementSelection = "group" | "pane";
export type PaneRuntimeState = "frozen" | "hidden" | "live";
export type PaneSizingMode = "default" | "fit-content" | "minimum" | "full";
export type FocusDirection = "down" | "left" | "right" | "up";
export type PaneMoveDirection = FocusDirection;
export type ColumnFocusEdge = "first" | "last";

export interface WorkspaceGridCursor {
  column: number;
  row: number;
  split: number;
}

export interface WorkspaceGridOrigin {
  column: number;
  row: number;
}

export type WorkspaceGridCellKind = "empty" | "occupied" | "reserved";

export interface WorkspaceGridCellBox extends Rect {
  columnId: ColumnId | null;
  cursor: WorkspaceGridCursor;
  kind: WorkspaceGridCellKind;
  paneId: PaneId | null;
  structural: boolean;
}

export interface WorkspaceGridCursorRenderItem {
  cursor: WorkspaceGridCursor;
  height: number;
  kind: WorkspaceGridCellKind;
  paneId: PaneId | null;
  presentationMode: WorkspacePresentationMode;
  scale: number;
  structural: boolean;
  width: number;
  x: number;
  y: number;
}

export interface WorkspaceGridCameraTarget {
  horizontalAnchorOffset: number;
  scrollColumn: number;
  scrollRow: number;
  verticalAnchorOffset: number;
}

export interface PaneSizeTarget {
  heightPx: number;
  paneId: PaneId;
  widthPx: number;
}

export interface Rect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ColumnWidthSpec {
  value: number;
  unit: "proportion" | "px";
}

export type PaneDimension = number | "viewport" | "auto";
export type PaneContentFit = "contain" | "cover" | "fill";

export interface PaneContentDefaults {
  aspectRatio?: number;
  fit?: PaneContentFit;
}

export interface PaneDefaults {
  width?: PaneDimension;
  height?: PaneDimension;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  content?: PaneContentDefaults;
}

export interface PaneDefaultsConfiguration {
  paneDefaults?: PaneDefaults;
  paneTypeDefaults?: Readonly<Record<SurfaceKind, PaneDefaults>>;
}

export interface PaneSizingConfiguration extends PaneDefaultsConfiguration {
  fullPaneSizing?: boolean;
}

export interface PaneCellSizing {
  heightPx?: number;
  weight: number;
}

export interface WorkspaceCell extends PaneCellSizing {
  paneId: PaneCell;
  reserved: boolean;
}

export interface WorkspacePane {
  defaults?: PaneDefaults;
  columnId: ColumnId;
  data?: unknown;
  paneId: PaneId;
  sequence: number;
  subtitle: string;
  surfaceId: SurfaceId;
  surfaceKind: SurfaceKind;
  title: string;
  tone: PaneTone;
}

export interface WorkspaceColumn {
  widthOverride?: boolean;
  cells: WorkspaceCell[];
  columnId: ColumnId;
  idealWidthSpec: ColumnWidthSpec;
  index: number;
  planeIndex: number;
  previousProportionWidth?: number;
  slotIndex?: number;
  widthSpec: ColumnWidthSpec;
}

export interface WorkspaceScene extends PaneSizingConfiguration {
  columnGap: number;
  columns: WorkspaceColumn[];
  defaultColumnWidthSpec: ColumnWidthSpec;
  gridAxes: WorkspaceGridAxes;
  id: string;
  paneById: ReadonlyMap<PaneId, WorkspacePane>;
  panes: WorkspacePane[];
  panesPerColumn: number;
  padding: number;
  renderOverscanColumns: number;
  rowGap: number;
  targetVisiblePanes: number;
  totalPanes: number;
  visibleColumnCount: number;
}

export interface OpenPaneRequest {
  defaults?: PaneDefaults;
  adjacentToColumnId?: ColumnId;
  columnId?: ColumnId;
  data?: unknown;
  subtitle?: string;
  surfaceKind?: SurfaceKind;
  title?: string;
  tone?: PaneTone;
  weight?: number;
  widthSpec?: ColumnWidthSpec;
}

export type PaneInsertionPlacement = "above" | "below" | "right";

export type PaneLimitPolicy = Partial<Record<SurfaceKind, number>>;

export interface LayoutFrameInput {
  cursor?: WorkspaceGridCursor;
  focusedPaneId: PaneId | null;
  horizontalAnchorOffset?: number;
  maximizedPaneId: PaneId | null;
  movementPhase: "idle" | "moving";
  overviewPanX?: number;
  overviewPanY?: number;
  overviewFollowOffsetX?: number;
  overviewFollowOffsetY?: number;
  overviewFixedScale?: number;
  overviewZoom?: number;
  presentationMode: WorkspacePresentationMode;
  renderAllColumns?: boolean;
  scrollColumn: number;
  scrollRow: number;
  verticalAnchorOffset?: number;
  viewport: Rect;
}

export interface PaneRenderItem {
  focused: boolean;
  height: number;
  maximized: boolean;
  moving: boolean;
  opacity: number;
  paneId: PaneId;
  placeholderOnly?: boolean;
  planeIndex?: number;
  presentationMode: WorkspacePresentationMode;
  preload?: boolean;
  resizing: boolean;
  runtimeState: PaneRuntimeState;
  scale: number;
  surfaceId: SurfaceId;
  surfaceKind: SurfaceKind;
  visible: boolean;
  width: number;
  x: number;
  y: number;
  z: number;
}

export interface PaneWorldBox {
  height: number;
  paneId: PaneId;
  scale: number;
  width: number;
  x: number;
  y: number;
}

export interface WorkspaceWorldFrame {
  focalScreenX: number;
  focalScreenY: number;
  focalWorldX: number;
  focalWorldY: number;
  grid: Rect;
  scale: number;
  x: number;
  y: number;
}

export interface ReservedCellRenderItem {
  columnId: ColumnId;
  height: number;
  planeIndex: number;
  presentationMode: WorkspacePresentationMode;
  rowIndex: number;
  scale: number;
  width: number;
  x: number;
  y: number;
}

export interface LayoutEngine {
  closePane(paneId: PaneId): void;
  configurePane(paneId: PaneId, request: OpenPaneRequest): PaneId;
  createReservedBlankSplit(paneId: PaneId, direction: "up" | "down"): boolean;
  gridCellBox(
    cursor: WorkspaceGridCursor,
    viewport: Rect,
    maximizedPaneId?: PaneId | null,
    origin?: WorkspaceGridOrigin,
  ): WorkspaceGridCellBox;
  gridCursorRenderItem(input: LayoutFrameInput): WorkspaceGridCursorRenderItem;
  insertPaneAsSplit(paneId: PaneId, direction: "left" | "right"): boolean;
  movePane(paneId: PaneId, direction: PaneMoveDirection): boolean;
  movePaneGroup(paneId: PaneId, direction: PaneMoveDirection): boolean;
  openPane(request: OpenPaneRequest): PaneId;
  openPaneNearPane(
    paneId: PaneId,
    placement: PaneInsertionPlacement,
    request: OpenPaneRequest,
  ): PaneId;
  paneWorldBoxes(
    viewport: Rect,
    maximizedPaneId?: PaneId | null,
    origin?: WorkspaceGridOrigin,
  ): readonly PaneWorldBox[];
  renderFrame(
    input: LayoutFrameInput,
    push: (item: PaneRenderItem) => void,
  ): void;
  renamePane(paneId: PaneId, title: string): boolean;
  removeReservedBlankSplit(paneId: PaneId, direction: "up" | "down"): boolean;
  resetColumnWidth(columnId: ColumnId): void;
  resizeColumn(columnId: ColumnId, width: ColumnWidthSpec): void;
  resizePane(paneId: PaneId, heightPx: number | null): void;
  resizePaneSplit(
    upperPaneId: PaneId,
    lowerPaneId: PaneId,
    upperHeightWeight: number,
    lowerHeightWeight: number,
    viewport: Rect,
  ): boolean;
  setCompactLayout(compact: boolean, panePeekPx?: number): void;
  splitPane(
    paneId: PaneId,
    direction: "up" | "down" | "left" | "right",
  ): PaneId;
  splitPaneToPlane(paneId: PaneId, direction: "up" | "down"): PaneId;
  toScene(id?: string): WorkspaceScene;
}
