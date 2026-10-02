import type {
  PanePresentation,
  PanePresentationResolver,
  PanePresentationState,
} from "../presentation/pane-presentation-policy";
import type {
  OnirigiriCaptureStatus,
  OnirigiriPanePictureResolver,
} from "../pictures/pane-picture-types";
import type { ReactNode } from "react";

import type { WorkspaceLayoutSnapshot } from "../state/layout-store";
import type { WorkspaceLayoutChangeKind } from "../state/layout-store-types";
import type {
  OnirigiriChromeComponents,
  OnirigiriSlotClassNames,
  OnirigiriSlotStyles,
} from "../styles/onirigiri-styling";
import type {
  OnirigiriThemeTokens,
  OnirigiriWorkspaceStyle,
} from "../styles/onirigiri-theme";
import type {
  OnirigiriCameraMotion,
  OnirigiriFocusHighlightOptions,
  ColumnFocusEdge,
  FocusDirection,
  OpenPaneRequest,
  PaneId,
  PaneContentDefaults,
  PaneDefaultsConfiguration,
  PaneInsertionPlacement,
  PaneLimitPolicy,
  PaneRearrangementSelection,
  PaneMoveDirection,
  PaneRuntimeState,
  PaneSizingMode,
  WorkspaceCameraModes,
  WorkspaceDirectionControlMode,
  WorkspaceFocusAnchor,
  WorkspaceGridAxes,
  WorkspacePane,
  WorkspacePresentationMode,
  WorkspaceScene,
} from "../types";
import type {
  OnirigiriLayout,
  OnirigiriPaneDefinition,
} from "./workspace-scene";
import type {
  OnirigiriShortcutBindings,
  OnirigiriShortcutScope,
} from "../input/workspace-shortcuts";

export interface OnirigiriPaneRenderState {
  content?: PaneContentDefaults;
  focused: boolean;
  frozen: boolean;
  maximized: boolean;
  presentationMode: WorkspacePresentationMode;
  runtimeState: PaneRuntimeState;
  visible: boolean;
}

export type OnirigiriPaneRenderer = (
  pane: WorkspacePane,
  state: OnirigiriPaneRenderState,
) => ReactNode;

export type OnirigiriLayoutChangeKind = WorkspaceLayoutChangeKind;

export interface OnirigiriLayoutChangeMetadata {
  kind: OnirigiriLayoutChangeKind;
  mutationId: number;
  layoutRevision: number;
}

export interface OnirigiriWorkspaceHandle {
  closePane(paneId: PaneId): Promise<boolean>;
  configurePane(paneId: PaneId, request: OpenPaneRequest): PaneId;
  createReservedBlankSplit(direction: "up" | "down"): boolean;
  clearPaneRearrangementGroup(): boolean;
  focus(direction: FocusDirection): boolean;
  focusColumn(edge: ColumnFocusEdge): boolean;
  focusPane(paneId: PaneId): boolean;
  returnHome(): boolean;
  getLayout(): OnirigiriLayout;
  getScene(): WorkspaceScene;
  getSnapshot(): WorkspaceLayoutSnapshot;
  openPane(request: OpenPaneRequest): PaneId;
  openPaneNear(
    paneId: PaneId,
    placement: PaneInsertionPlacement,
    request: OpenPaneRequest,
  ): PaneId;
  movePane(direction: PaneMoveDirection): boolean;
  movePaneGroup(direction: PaneMoveDirection): boolean;
  renamePane(paneId: PaneId, title: string): boolean;
  insertPaneAsSplit(direction: "left" | "right"): boolean;
  removeReservedBlankSplit(direction: "up" | "down"): boolean;
  getCaptureStatus(): OnirigiriCaptureStatus;
  getPanePresentationState(paneId: PaneId): PanePresentationState;
  refreshPanePictures(): void;
  restoreLayout(layout: OnirigiriLayout): void;
  resizePanes(mode: PaneSizingMode): void;
  setFocusAnchor(anchor: WorkspaceFocusAnchor): void;
  selectPaneGroup(): boolean;
  splitPane(
    paneId: PaneId,
    direction: "up" | "down" | "left" | "right",
  ): PaneId;
  splitPaneToPlane(paneId: PaneId, direction: "up" | "down"): PaneId;
  toggleOverview(): void;
}

export type OnirigiriMinimapCorner =
  "bottom-left" | "bottom-right" | "top-left" | "top-right";

export interface OnirigiriMinimapPlacement {
  corner: OnirigiriMinimapCorner;
  heightPx: number;
  widthPx: number;
}

export interface OnirigiriWorkspaceProps extends PaneDefaultsConfiguration {
  allowResizedPanesToOverflowViewport?: boolean;
  ariaLabel?: string;
  chromeComponents?: OnirigiriChromeComponents;
  cameraMotion?: OnirigiriCameraMotion;
  className?: string;
  classNames?: OnirigiriSlotClassNames;
  compactBreakpoint?: number;
  compactPanePeek?: number;
  cursorRunway?: number;
  desktopControlsContainer?: Element | null;
  directionControlMode?: WorkspaceDirectionControlMode;
  focusAnchor?: WorkspaceFocusAnchor;
  focusHighlight?: boolean | OnirigiriFocusHighlightOptions;
  gridAxes?: WorkspaceGridAxes;
  initialLayout?: OnirigiriLayout | null;
  initialPanes?: readonly OnirigiriPaneDefinition[];
  minimapAdjustable?: boolean;
  minimapPlacement?: Partial<OnirigiriMinimapPlacement>;
  onLayoutChange?: (
    layout: OnirigiriLayout,
    metadata: OnirigiriLayoutChangeMetadata,
  ) => void;
  onMinimapPlacementChange?: (placement: OnirigiriMinimapPlacement) => void;
  onPaneClose?: (pane: WorkspacePane) => boolean | Promise<boolean>;
  onPaneRearrangementSelectionChange?: (
    selection: PaneRearrangementSelection,
  ) => void;
  onPresentationModeChange?: (mode: WorkspacePresentationMode) => void;
  overviewCardMaxWidthPx?: number;
  overviewCardMinWidthPx?: number;
  paneLimits?: PaneLimitPolicy;
  cameraModes?: WorkspaceCameraModes;
  getPanePicture?: OnirigiriPanePictureResolver;
  panePresentation?: PanePresentation;
  getPanePresentation?: PanePresentationResolver;
  renderPanePlaceholder?: (
    pane: WorkspacePane,
    state: PanePresentationState,
  ) => ReactNode;
  liveContent?: boolean;
  onPanePresentationChange?: (
    paneId: PaneId,
    state: PanePresentationState,
  ) => void;
  onCaptureStatusChange?: (status: OnirigiriCaptureStatus) => void;
  pictureBudgetBytes?: number;
  pictureRasterBudgetBytes?: number;
  pictureMinLongEdgePx?: number;
  captureMissingOverviewPictures?: boolean;
  renderPane: OnirigiriPaneRenderer;
  retainedAreaBudgetViewports?: number;
  preloadMarginPanes?: number;
  preloadAllPanePictures?: boolean;
  shortcutScope?: OnirigiriShortcutScope;
  shortcuts?: OnirigiriShortcutBindings | false;
  showControls?: boolean;
  showMinimap?: boolean;
  showOverviewControl?: boolean;
  style?: OnirigiriWorkspaceStyle;
  styles?: OnirigiriSlotStyles;
  tokens?: OnirigiriThemeTokens;
  workspaceId?: string;
}
