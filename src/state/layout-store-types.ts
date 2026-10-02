import type {
  ColumnId,
  PaneId,
  PaneLimitPolicy,
  PaneRearrangementSelection,
  SurfaceKind,
  WorkspaceCameraModes,
  WorkspaceFocusAnchor,
  WorkspaceGridCursor,
  WorkspacePresentationMode,
  WorkspaceScene,
} from "../types";

export type WorkspaceLayoutChangeKind = "initial" | "restore" | "user";

export interface WorkspaceLayoutStoreOptions {
  cursorRunway?: number;
  initialCameraModes?: WorkspaceCameraModes;
  initialFocusAnchor?: WorkspaceFocusAnchor;
  initialMaximizedPaneId?: PaneId | null;
  paneLimits?: PaneLimitPolicy;
}

export interface WorkspaceLayoutSnapshot {
  cursor: WorkspaceGridCursor;
  focusAnchor: WorkspaceFocusAnchor;
  focusedPaneId: PaneId | null;
  horizontalAnchorOffset: number;
  layoutChangeKind: WorkspaceLayoutChangeKind;
  layoutMutationId: number;
  layoutRevision: number;
  maximizedPaneId: PaneId | null;
  overviewPanX: number;
  overviewPanY: number;
  overviewFollowOffsetX: number;
  overviewFollowOffsetY: number;
  overviewFixedScale?: number;
  overviewProgress: number;
  overviewZoom: number;
  paneRearrangementRevision: number;
  paneRearrangementSelection: PaneRearrangementSelection;
  presentationMode: WorkspacePresentationMode;
  revision: number;
  scrollColumn: number;
  scrollRow: number;
  selectedGroupColumnId: ColumnId | null;
  targetHorizontalAnchorOffset: number;
  targetScrollColumn: number;
  targetScrollRow: number;
  targetVerticalAnchorOffset: number;
  verticalAnchorOffset: number;
}

export interface WorkspacePaneRearrangementSource {
  affectedPaneIds: readonly PaneId[];
  revision: number;
  scene: WorkspaceScene;
  snapshot: WorkspaceLayoutSnapshot;
}

export interface WorkspacePaneLimitState {
  allowed: boolean;
  count: number;
  limit: number | null;
  surfaceKind: SurfaceKind | null;
}
