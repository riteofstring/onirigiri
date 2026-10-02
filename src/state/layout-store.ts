import {
  createWorkspaceState,
  copyWorkspaceCameraModes,
  deriveWorkspaceState,
  nextWorkspaceRevision,
} from "./layout-store-state";

import type { WorkspaceLikeLayoutEngine } from "../layout/layout-engine";
import {
  WorkspaceCameraMotion,
  workspaceScrollRowIsSettled,
} from "./layout-store-animation";
import type { ResolvedCameraMotion } from "../presentation/motion-curve";
import { PaneRearrangementController } from "./layout-store-rearrangement";
import { WorkspacePaneOpeningController } from "./layout-store-pane-opening";
import { restoredWorkspaceScene } from "./layout-store-restoration";
import { WorkspaceSizingController } from "./layout-store-sizing";
import { emptyFramePaneRequest } from "./layout-store-helpers";
import { defaultWorkspaceCameraModes } from "../types";
import type {
  WorkspaceLayoutSnapshot,
  WorkspaceLayoutStoreOptions,
  WorkspacePaneRearrangementSource,
} from "./layout-store-types";
import { WorkspaceOverviewCamera } from "../layout/overview-camera";
import {
  nextWorkspaceGridCursor,
  normalizeWorkspaceGridCursor,
  paneIdAtWorkspaceGridCursor,
  resolveWorkspaceCursorRunway,
  workspaceColumnAtGridCursor,
  workspaceCursorMoveIsWithinRunway,
  workspaceGridCursorsEqual,
  workspaceGridCursorForPane,
  workspacePaneCursorRunwayBounds,
  type WorkspaceCursorRunwayBounds,
} from "../workspace/workspace-grid-cursor";
import type {
  ColumnFocusEdge,
  ColumnId,
  ColumnWidthSpec,
  FocusDirection,
  OpenPaneRequest,
  PaneId,
  PaneDefaultsConfiguration,
  PaneInsertionPlacement,
  PaneMoveDirection,
  PaneSizeTarget,
  PaneSizingMode,
  Rect,
  WorkspaceCameraMode,
  WorkspaceCameraModes,
  WorkspaceFocusAnchor,
  WorkspaceGridCursor,
  WorkspaceScene,
} from "../types";
import type { OnirigiriLayout } from "../workspace/workspace-scene";

export type {
  WorkspaceLayoutSnapshot,
  WorkspacePaneRearrangementSource,
} from "./layout-store-types";

type LayoutStoreListener = (snapshot: WorkspaceLayoutSnapshot) => void;
const defaultViewportHeight = 900;

function unboundedFocusMoveAvailability(
  cursor: WorkspaceGridCursor,
  direction: FocusDirection,
  gridAxes: WorkspaceScene["gridAxes"],
): boolean | null {
  if (direction === "left" || direction === "right") {
    const delta = direction === "left" ? -1 : 1;
    return Number.isSafeInteger(cursor.column + delta);
  }
  if (gridAxes !== "spatial") {
    return null;
  }
  const delta = direction === "up" ? -1 : 1;
  return Number.isSafeInteger(cursor.row + delta) ? true : null;
}

export class WorkspaceLayoutStore {
  private readonly state: ReturnType<typeof createWorkspaceState>;
  private activeLayoutMutationId: number | null = null;
  private paneRearrangementSource: WorkspacePaneRearrangementSource | null =
    null;
  private cameraModesByPresentation: WorkspaceCameraModes = {
    ...defaultWorkspaceCameraModes,
  };
  private readonly cameraMotion = new WorkspaceCameraMotion();
  private cursorRunway: number | null;
  private cursorRunwayBounds: WorkspaceCursorRunwayBounds | null;
  private readonly homePaneId: PaneId;
  private readonly paneRearrangement: PaneRearrangementController;
  private readonly paneOpening: WorkspacePaneOpeningController;
  private readonly sizing: WorkspaceSizingController;
  private focusRevealSuppressed = false;
  private initialCursorCameraPending = true;
  private readonly overviewCamera = new WorkspaceOverviewCamera();
  private scene: WorkspaceScene;
  private lastViewport: Rect = {
    height: defaultViewportHeight,
    width: 1200,
    x: 0,
    y: 0,
  };

  constructor(
    private readonly engine: WorkspaceLikeLayoutEngine,
    scene: WorkspaceScene,
    initialCursor: WorkspaceGridCursor,
    options: WorkspaceLayoutStoreOptions = {},
  ) {
    this.scene = scene;
    this.cursorRunway = resolveWorkspaceCursorRunway(options.cursorRunway);
    this.cursorRunwayBounds = workspacePaneCursorRunwayBounds(scene);
    this.homePaneId =
      paneIdAtWorkspaceGridCursor(scene, initialCursor) ??
      scene.panes[0]!.paneId;
    this.paneRearrangement = new PaneRearrangementController({
      capturePaneRearrangementSource: () =>
        this.capturePaneRearrangementSource(),
      completePaneRearrangementSource: () =>
        this.completePaneRearrangementSource(),
      discardPaneRearrangementSource: () =>
        this.discardPaneRearrangementSource(),
      engine,
      focusedColumnId: () => this.focusedColumnId(),
      focusedPaneId: () => this.focusedPaneId(),
      holdCameraPosition: () => this.holdCameraPosition(),
      incrementRevision: () => {
        this.state.current.setState({
          paneRearrangementRevision:
            this.getSnapshot().paneRearrangementRevision + 1,
        });
      },
      notify: (layoutChanged) => this.notify(layoutChanged),
      setCursorForPaneWithoutCamera: (paneId) =>
        this.setCursorForPaneWithoutCamera(paneId),
    });
    this.paneOpening = new WorkspacePaneOpeningController({
      commitPane: (paneId) => {
        this.setCursorForPane(paneId);
        this.notify();
      },
      currentColumnId: () => this.currentColumnId(),
      engine,
      paneLimits: options.paneLimits,
      scene: () => this.toScene(),
    });
    this.sizing = new WorkspaceSizingController({
      engine,
      focusedColumnId: () => this.focusedColumnId(),
      notify: () => this.notify(),
      scene: () => this.toScene(),
      updateViewport: (viewport) => this.updateViewportAfterSizing(viewport),
      viewport: () => this.lastViewport,
    });
    this.state = createWorkspaceState(
      scene,
      initialCursor,
      options,
      this.overviewCamera,
      this.paneRearrangement,
    );
    this.cameraModesByPresentation = copyWorkspaceCameraModes(
      options.initialCameraModes,
    );
    this.retargetCameraForCursor();
    this.snapScrollToTarget();
    if (
      options.initialMaximizedPaneId &&
      this.engine.paneLocation(options.initialMaximizedPaneId)
    ) {
      this.state.current.setState({
        maximizedPaneId: options.initialMaximizedPaneId,
      });
    }
  }

  advanceFrame(deltaMs: number): "idle" | "moving" {
    const frame = this.cameraMotion.advance({
      ...this.getSnapshot(),
      deltaMs,
      overviewProgress: this.overviewCamera.overviewProgress,
      targetOverviewProgress: this.overviewCamera.targetOverviewProgress,
    });
    this.state.current.setState({
      scrollColumn: frame.scrollColumn,
      horizontalAnchorOffset: frame.horizontalAnchorOffset,
      scrollRow: frame.scrollRow,
      verticalAnchorOffset: frame.verticalAnchorOffset,
    });
    if (frame.state === "moving") {
      this.overviewCamera.setProgress(frame.overviewProgress);
    }
    if (frame.snapOverviewProgress) {
      this.overviewCamera.snapProgressToTarget();
    }
    if (frame.state === "idle") {
      this.overviewCamera.resetCameraAfterExit();
    }
    this.state.current.setState(this.createSnapshot());
    return frame.state;
  }

  beginLayoutMutationGroup(): void {
    this.activeLayoutMutationId ??= this.getSnapshot().layoutMutationId + 1;
    this.state.current.setState({
      layoutMutationId: this.activeLayoutMutationId,
    });
  }

  endLayoutMutationGroup(): void {
    this.activeLayoutMutationId = null;
  }

  focusedPaneId(): PaneId | null {
    return paneIdAtWorkspaceGridCursor(
      this.toScene(),
      this.getSnapshot().cursor,
    );
  }

  getSnapshot(): WorkspaceLayoutSnapshot {
    return this.state.current.getState();
  }

  private createSnapshot(
    scene: WorkspaceScene = this.toScene(),
  ): WorkspaceLayoutSnapshot {
    return deriveWorkspaceState(
      this.getSnapshot(),
      scene,
      this.overviewCamera,
      this.paneRearrangement,
    );
  }

  private capturePaneRearrangementSource(): void {
    this.paneRearrangementSource = {
      affectedPaneIds: [],
      revision: this.getSnapshot().paneRearrangementRevision + 1,
      scene: this.toScene(),
      snapshot: this.getSnapshot(),
    };
  }

  private completePaneRearrangementSource(): void {
    const source = this.paneRearrangementSource;
    if (!source) {
      return;
    }
    const target = this.toScene();
    const paneIds = new Set([
      ...source.scene.panes.map((pane) => pane.paneId),
      ...target.panes.map((pane) => pane.paneId),
    ]);
    const affectedPaneIds = [...paneIds].filter((paneId) => {
      const before = workspaceGridCursorForPane(source.scene, paneId);
      const after = workspaceGridCursorForPane(target, paneId);
      return !before || !after || !workspaceGridCursorsEqual(before, after);
    });
    this.paneRearrangementSource = { ...source, affectedPaneIds };
  }

  private discardPaneRearrangementSource(): void {
    this.paneRearrangementSource = null;
  }

  moveFocus(direction: FocusDirection, viewport?: Rect): boolean {
    const previousViewport = this.lastViewport;
    if (viewport) {
      this.lastViewport = viewport;
    }
    if (!this.moveCursor(direction)) {
      this.lastViewport = previousViewport;
      return false;
    }
    this.notify(false);
    return true;
  }

  moveFocusFromPane(
    paneId: PaneId,
    direction: FocusDirection,
    viewport?: Rect,
  ): boolean {
    const previousViewport = this.lastViewport;
    if (viewport) {
      this.lastViewport = viewport;
    }
    const sourceCursor = workspaceGridCursorForPane(this.toScene(), paneId);
    if (!sourceCursor) {
      this.lastViewport = previousViewport;
      return false;
    }
    const sourceChanged = !workspaceGridCursorsEqual(
      sourceCursor,
      this.getSnapshot().cursor,
    );
    if (sourceChanged) {
      this.setCursor(sourceCursor);
    }
    const moved = this.moveCursor(direction);
    if (!sourceChanged && !moved) {
      this.lastViewport = previousViewport;
      return false;
    }
    this.notify(false);
    return true;
  }

  canMoveFocus(direction: FocusDirection, scene?: WorkspaceScene): boolean {
    const current = this.getSnapshot().cursor;
    if (this.cursorRunway === null) {
      const availability = unboundedFocusMoveAvailability(
        current,
        direction,
        this.scene.gridAxes,
      );
      if (availability !== null) {
        return availability;
      }
    }
    const currentScene = scene ?? this.toScene();
    const next = nextWorkspaceGridCursor({
      cursor: current,
      direction,
      scene: currentScene,
    });
    return (
      next !== null &&
      workspaceCursorMoveIsWithinRunway({
        bounds: this.cursorRunwayBounds,
        current,
        next,
        runway: this.cursorRunway,
      })
    );
  }

  private moveCursor(direction: FocusDirection): boolean {
    const current = this.getSnapshot().cursor;
    const scene = this.toScene();
    const nextCursor = nextWorkspaceGridCursor({
      cursor: current,
      direction,
      scene,
    });
    if (
      !nextCursor ||
      !workspaceCursorMoveIsWithinRunway({
        bounds: this.cursorRunwayBounds,
        current,
        next: nextCursor,
        runway: this.cursorRunway,
      })
    ) {
      return false;
    }
    this.setCursor(nextCursor, scene);
    return true;
  }

  returnHome(viewport: Rect = this.lastViewport): boolean {
    this.lastViewport = viewport;
    const scene = this.toScene();
    const paneId = scene.paneById.has(this.homePaneId)
      ? this.homePaneId
      : scene.panes[0]?.paneId;
    if (!paneId) {
      return false;
    }
    return this.overviewCamera.mode === "overview"
      ? this.focusOverviewPane(paneId, viewport)
      : this.focusPane(paneId);
  }

  setCursorRunway(cursorRunway: number | undefined): void {
    const next = resolveWorkspaceCursorRunway(cursorRunway);
    if (next === this.cursorRunway) {
      return;
    }
    this.cursorRunway = next;
    this.notify(false);
  }

  focusColumn(edge: ColumnFocusEdge, viewport?: Rect): boolean {
    if (viewport) {
      this.lastViewport = viewport;
    }
    const scene = this.toScene();
    const targetColumn = scene.columns
      .filter((column) => column.planeIndex === this.getSnapshot().cursor.row)
      .toSorted(
        (left, right) =>
          (left.slotIndex ?? left.index) - (right.slotIndex ?? right.index),
      )
      .at(edge === "first" ? 0 : -1);
    if (!targetColumn) {
      return false;
    }
    const nextCursor = normalizeWorkspaceGridCursor(scene, {
      ...this.getSnapshot().cursor,
      column: targetColumn.slotIndex ?? targetColumn.index,
    });
    if (workspaceGridCursorsEqual(nextCursor, this.getSnapshot().cursor)) {
      return false;
    }
    this.setCursor(nextCursor);
    this.notify(false);
    return true;
  }

  closePane(paneId: PaneId): PaneId | null {
    const cursor = workspaceGridCursorForPane(this.toScene(), paneId);
    if (!cursor) {
      return null;
    }
    if (this.engine.paneCount() <= 1) {
      return null;
    }
    this.setCursor(cursor);
    this.engine.closePane(paneId);
    if (this.getSnapshot().maximizedPaneId === paneId) {
      this.state.current.setState({ maximizedPaneId: null });
    }
    this.state.current.setState({
      cursor: normalizeWorkspaceGridCursor(
        this.toScene(),
        this.getSnapshot().cursor,
      ),
    });
    this.notify();
    return paneId;
  }

  closePaneOrClearLastPane(paneId: PaneId): PaneId {
    if (!this.engine.paneLocation(paneId)) {
      throw new Error(`unknown workspace pane ${paneId}`);
    }
    if (this.engine.paneCount() <= 1) {
      this.configurePane(paneId, emptyFramePaneRequest());
      return paneId;
    }
    const closedPaneId = this.closePane(paneId);
    if (!closedPaneId) {
      throw new Error(
        "Onirigiri failed to close a pane from a multi-pane workspace",
      );
    }
    return closedPaneId;
  }

  moveFocusedPane(direction: PaneMoveDirection): boolean {
    const paneId = this.focusedPaneId();
    if (!paneId) {
      return false;
    }
    this.capturePaneRearrangementSource();
    if (!this.engine.movePane(paneId, direction)) {
      this.discardPaneRearrangementSource();
      return false;
    }
    this.completePaneRearrangementSource();
    this.holdCameraPosition();
    this.setCursorForPaneWithoutCamera(paneId);
    if (
      this.overviewCamera.mode === "overview" &&
      this.cameraMode() === "follow"
    ) {
      this.retargetOverviewFollowCamera();
    }
    this.paneRearrangement.clearWithoutNotify();
    this.state.current.setState({
      paneRearrangementRevision:
        this.getSnapshot().paneRearrangementRevision + 1,
    });
    this.notify();
    return true;
  }

  selectFocusedPaneGroup(): boolean {
    return this.paneRearrangement.select();
  }

  clearPaneRearrangementGroup(): boolean {
    return this.paneRearrangement.clear();
  }

  moveSelectedPaneGroup(direction: PaneMoveDirection): boolean {
    return this.paneRearrangement.move(direction);
  }

  paneRearrangementSourceFor(
    revision: number,
  ): WorkspacePaneRearrangementSource | null {
    return this.paneRearrangementSource?.revision === revision
      ? this.paneRearrangementSource
      : null;
  }

  clearPaneRearrangementSource(revision?: number): void {
    if (
      this.paneRearrangementSource &&
      (revision === undefined ||
        this.paneRearrangementSource.revision === revision)
    ) {
      this.paneRearrangementSource = null;
    }
  }

  insertFocusedPaneAsSplit(direction: "left" | "right"): boolean {
    return this.paneRearrangement.insert(direction);
  }

  createFocusedReservedBlankSplit(direction: "up" | "down"): boolean {
    return this.paneRearrangement.createBlank(direction);
  }

  removeFocusedReservedBlankSplit(direction: "up" | "down"): boolean {
    return this.paneRearrangement.removeBlank(direction);
  }

  cameraMode(): WorkspaceCameraMode {
    return this.cameraModesByPresentation[this.overviewCamera.mode];
  }

  cameraModes(): WorkspaceCameraModes {
    return { ...this.cameraModesByPresentation };
  }

  applyPaneRearrangementCameraOffset(offset: {
    x: number;
    y: number;
  }): WorkspaceLayoutSnapshot {
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
      return this.getSnapshot();
    }
    if (this.overviewCamera.mode === "overview") {
      this.overviewCamera.applyFollowOffset(offset);
    } else {
      const snapshot = this.getSnapshot();
      const current = {
        horizontalAnchorOffset: snapshot.horizontalAnchorOffset - offset.x,
        scrollColumn: snapshot.scrollColumn,
        scrollRow: snapshot.scrollRow,
        verticalAnchorOffset: snapshot.verticalAnchorOffset - offset.y,
      };
      const target = {
        horizontalAnchorOffset:
          snapshot.targetHorizontalAnchorOffset - offset.x,
        scrollColumn: snapshot.targetScrollColumn,
        scrollRow: snapshot.targetScrollRow,
        verticalAnchorOffset: snapshot.targetVerticalAnchorOffset - offset.y,
      };
      this.state.current.setState({
        horizontalAnchorOffset: current.horizontalAnchorOffset,
      });
      this.state.current.setState({ scrollColumn: current.scrollColumn });
      this.state.current.setState({ scrollRow: current.scrollRow });
      this.state.current.setState({
        verticalAnchorOffset: current.verticalAnchorOffset,
      });
      this.state.current.setState({
        targetHorizontalAnchorOffset: target.horizontalAnchorOffset,
      });
      this.state.current.setState({ targetScrollColumn: target.scrollColumn });
      this.state.current.setState({ targetScrollRow: target.scrollRow });
      this.state.current.setState({
        targetVerticalAnchorOffset: target.verticalAnchorOffset,
      });
    }
    this.state.current.setState(this.createSnapshot());
    return this.getSnapshot();
  }

  setCameraMotion(motion: ResolvedCameraMotion): void {
    this.cameraMotion.configure(motion);
  }

  setCameraModes(modes: WorkspaceCameraModes): void {
    const next = copyWorkspaceCameraModes(modes);
    if (
      next.normal === this.cameraModesByPresentation.normal &&
      next.overview === this.cameraModesByPresentation.overview
    ) {
      return;
    }
    const activeMode = this.cameraMode();
    this.cameraModesByPresentation = next;
    if (
      this.overviewCamera.mode === "overview" &&
      activeMode !== this.cameraMode()
    ) {
      this.overviewCamera.configureForMode(this.overviewCameraInput());
    }
    this.notify(false);
  }

  openPane(request: OpenPaneRequest): PaneId {
    return this.paneOpening.open(request);
  }

  openPaneNear(
    paneId: PaneId,
    placement: PaneInsertionPlacement,
    request: OpenPaneRequest,
  ): PaneId {
    return this.paneOpening.openNear(paneId, placement, request);
  }

  configurePane(paneId: PaneId, request: OpenPaneRequest): PaneId {
    return this.paneOpening.configure(paneId, request);
  }

  splitFocusedPane(direction: "up" | "down" | "left" | "right"): PaneId | null {
    const paneId = this.focusedPaneId();
    return paneId ? this.splitPane(paneId, direction) : null;
  }

  splitPane(
    paneId: PaneId,
    direction: "up" | "down" | "left" | "right",
  ): PaneId {
    return this.paneOpening.split(paneId, direction);
  }

  splitFocusedPaneToPlane(direction: "up" | "down"): PaneId | null {
    const paneId = this.focusedPaneId();
    return paneId ? this.splitPaneToPlane(paneId, direction) : null;
  }

  splitPaneToPlane(paneId: PaneId, direction: "up" | "down"): PaneId {
    return this.paneOpening.splitToPlane(paneId, direction);
  }

  ensureFocusedColumnVisible(viewport: Rect): void {
    if (this.overviewCamera.mode === "overview") {
      this.lastViewport = viewport;
      this.retargetOverviewFollowCamera();
      return;
    }
    this.lastViewport = viewport;
    this.retargetCameraForCursor();
  }

  ensureFocusedPaneVisible(viewport: Rect): void {
    if (this.focusRevealSuppressed) {
      this.lastViewport = viewport;
      return;
    }
    if (this.initialCursorCameraPending) {
      this.lastViewport = viewport;
      this.initialCursorCameraPending = false;
      this.retargetCameraForCursor("center");
      this.snapScrollToTarget();
      return;
    }
    if (this.overviewCamera.mode === "overview") {
      this.lastViewport = viewport;
      this.retargetOverviewFollowCamera();
      return;
    }
    this.ensureFocusedColumnVisible(viewport);
    this.ensureFocusedRowVisible(viewport);
  }

  setFocusAnchor(
    focusAnchor: WorkspaceFocusAnchor,
    viewport: Rect = this.lastViewport,
  ): void {
    this.lastViewport = viewport;
    if (this.getSnapshot().focusAnchor === focusAnchor) {
      return;
    }
    this.state.current.setState({ focusAnchor: focusAnchor });
    this.reanchorFocusedPane(viewport);
  }

  reanchorFocusedPane(viewport: Rect = this.lastViewport): void {
    this.lastViewport = viewport;
    if (this.overviewCamera.mode === "overview") {
      this.notify(false);
      return;
    }
    this.focusRevealSuppressed = false;
    this.retargetCameraForCursor();
    this.notify(false);
  }

  ensureFocusedRowVisible(viewport: Rect): void {
    if (this.overviewCamera.mode === "overview") {
      this.lastViewport = viewport;
      this.retargetOverviewFollowCamera();
      return;
    }
    this.lastViewport = viewport;
    this.retargetCameraForCursor();
  }

  focusedColumnId(): ColumnId | null {
    return (
      workspaceColumnAtGridCursor(this.toScene(), this.getSnapshot().cursor)
        ?.columnId ?? null
    );
  }

  focusPane(paneId: PaneId): boolean {
    const cursor = workspaceGridCursorForPane(this.toScene(), paneId);
    if (!cursor) {
      return false;
    }
    this.setCursor(cursor);
    this.notify(false);
    return true;
  }

  focusOverviewPane(paneId: PaneId, viewport: Rect): boolean {
    const cursor = workspaceGridCursorForPane(this.toScene(), paneId);
    if (this.overviewCamera.mode !== "overview" || !cursor) {
      return false;
    }
    this.lastViewport = viewport;
    this.setCursorForPaneWithoutCamera(paneId);
    this.paneRearrangement.clearWithoutNotify();
    this.exitOverviewToFocusedPane();
    return true;
  }

  focusPaneWithoutReveal(paneId: PaneId): boolean {
    const cursor = workspaceGridCursorForPane(this.toScene(), paneId);
    if (!cursor) {
      return false;
    }
    const previousTargetScrollColumn = this.getSnapshot().targetScrollColumn;
    const previousTargetHorizontalAnchorOffset =
      this.getSnapshot().targetHorizontalAnchorOffset;
    const previousTargetScrollRow = this.getSnapshot().targetScrollRow;
    const previousTargetVerticalAnchorOffset =
      this.getSnapshot().targetVerticalAnchorOffset;
    this.setCursor(cursor);
    this.state.current.setState({
      targetScrollColumn: previousTargetScrollColumn,
      targetHorizontalAnchorOffset: previousTargetHorizontalAnchorOffset,
      targetScrollRow: previousTargetScrollRow,
      targetVerticalAnchorOffset: previousTargetVerticalAnchorOffset,
    });
    this.focusRevealSuppressed = true;
    this.notify(false);
    return true;
  }
  setPaneDefaults(configuration: PaneDefaultsConfiguration): void {
    if (!this.engine.setPaneDefaults(configuration)) return;
    this.updateViewportAfterSizing(this.lastViewport);
    this.notify();
  }

  resetFocusedColumnWidth(): boolean {
    return this.sizing.resetFocusedColumnWidth();
  }
  resizeColumn(columnId: ColumnId, width: ColumnWidthSpec): void {
    this.sizing.resizeColumn(columnId, width);
  }
  resizePaneSplit(
    upperPaneId: PaneId,
    lowerPaneId: PaneId,
    upperHeightWeight: number,
    lowerHeightWeight: number,
  ): boolean {
    return this.sizing.resizePaneSplit(
      upperPaneId,
      lowerPaneId,
      upperHeightWeight,
      lowerHeightWeight,
    );
  }
  resizePanes(
    targets: readonly PaneSizeTarget[],
    viewport: Rect,
    mode?: PaneSizingMode,
  ): void {
    this.sizing.resizePanes(targets, viewport, mode);
  }
  resetWorkspaceSizing(viewport: Rect): void {
    this.sizing.resetWorkspaceSizing(viewport);
  }
  resizePaneRow(paneId: PaneId, heightPx: number | null): boolean {
    return this.sizing.resizePaneRow(paneId, heightPx);
  }
  renamePane(paneId: PaneId, title: string): boolean {
    if (!this.engine.renamePane(paneId, title)) {
      return false;
    }
    this.setCursorForPane(paneId);
    this.notify();
    return true;
  }
  resizePaneColumn(paneId: PaneId, width: ColumnWidthSpec): ColumnId | null {
    return this.sizing.resizePaneColumn(paneId, width);
  }
  restoreLayout(layout: OnirigiriLayout): void {
    const restored = restoredWorkspaceScene(this.scene, layout);
    this.engine.restoreScene(restored.scene);
    this.scene = restored.scene;
    this.activeLayoutMutationId = null;
    this.focusRevealSuppressed = false;
    this.state.current.setState({ maximizedPaneId: null });
    this.overviewCamera.reset();
    this.clearPaneRearrangementSource();
    this.setCursor(restored.cursor);
    this.snapAnimationsToTarget();
    this.notify(true, "restore");
  }
  snapScrollToTarget(): void {
    this.state.current.setState({
      scrollColumn: this.getSnapshot().targetScrollColumn,
      horizontalAnchorOffset: this.getSnapshot().targetHorizontalAnchorOffset,
      scrollRow: this.getSnapshot().targetScrollRow,
      verticalAnchorOffset: this.getSnapshot().targetVerticalAnchorOffset,
    });
    this.state.current.setState(this.createSnapshot());
  }
  snapAnimationsToTarget(): void {
    this.cameraMotion.reset();
    this.snapScrollToTarget();
    this.overviewCamera.snapProgressToTarget();
    this.overviewCamera.resetCameraAfterExit();
    this.clearPaneRearrangementSource();
    this.state.current.setState(this.createSnapshot());
  }
  toScene(): WorkspaceScene {
    return this.engine.toScene(this.scene.id);
  }
  togglePaneMaximized(paneId: PaneId): void {
    if (!workspaceGridCursorForPane(this.toScene(), paneId)) {
      return;
    }
    this.state.current.setState({
      maximizedPaneId:
        this.getSnapshot().maximizedPaneId === paneId ? null : paneId,
    });
    this.setCursorForPane(paneId);
    this.notify();
  }
  toggleOverviewMode(): void {
    if (this.overviewCamera.mode === "overview") {
      this.exitOverviewToFocusedPane();
      return;
    }
    this.overviewCamera.enter(this.overviewCameraInput());
    this.notify(false);
  }

  panOverviewBy(deltaX: number, deltaY: number, viewport: Rect): boolean {
    if (this.overviewCamera.mode !== "overview") {
      return false;
    }
    this.lastViewport = viewport;
    if (
      !this.overviewCamera.pan({
        cursor: this.getSnapshot().cursor,
        deltaX,
        deltaY,
        engine: this.engine,
        maximizedPaneId: this.getSnapshot().maximizedPaneId,
        viewport,
      })
    ) {
      return false;
    }
    this.notify(false);
    return true;
  }

  zoomOverviewBy(
    zoomFactor: number,
    focalX: number,
    focalY: number,
    viewport: Rect,
  ): boolean {
    if (this.overviewCamera.mode !== "overview") {
      return false;
    }
    this.lastViewport = viewport;
    if (
      !this.overviewCamera.zoomBy({
        cursor: this.getSnapshot().cursor,
        engine: this.engine,
        focalX,
        focalY,
        maximizedPaneId: this.getSnapshot().maximizedPaneId,
        viewport,
        zoomFactor,
      })
    ) {
      return false;
    }
    this.notify(false);
    return true;
  }

  subscribe(listener: LayoutStoreListener): () => void {
    return this.state.commands.subscribe(listener);
  }

  private notify(
    layoutChanged = true,
    kind: WorkspaceLayoutSnapshot["layoutChangeKind"] = "user",
  ): void {
    const scene = this.toScene();
    if (layoutChanged) {
      this.cursorRunwayBounds = workspacePaneCursorRunwayBounds(scene);
    }
    const command = nextWorkspaceRevision(
      this.createSnapshot(scene),
      layoutChanged,
      kind,
      this.activeLayoutMutationId,
    );
    this.state.current.setState(command, true);
    this.state.commands.setState(command, true);
  }

  private currentColumnId(): ColumnId | undefined {
    return workspaceColumnAtGridCursor(
      this.toScene(),
      this.getSnapshot().cursor,
    )?.columnId;
  }

  private updateViewportAfterSizing(viewport: Rect): void {
    const state = this.getSnapshot();
    const columnWasAtTarget =
      Math.abs(state.scrollColumn - state.targetScrollColumn) <= 0.001;
    const horizontalAnchorWasAtTarget =
      Math.abs(
        state.horizontalAnchorOffset - state.targetHorizontalAnchorOffset,
      ) <= 0.001;
    const rowWasAtTarget = workspaceScrollRowIsSettled(
      state.scrollRow,
      state.targetScrollRow,
    );
    const verticalAnchorWasAtTarget =
      Math.abs(state.verticalAnchorOffset - state.targetVerticalAnchorOffset) <=
      0.001;
    this.lastViewport = viewport;
    if (this.overviewCamera.mode !== "normal") {
      this.retargetOverviewFollowCamera();
      return;
    }
    if (this.focusRevealSuppressed && state.focusAnchor !== "center") {
      return;
    }
    const target = this.cursorCameraTarget();
    this.state.current.setState({
      targetScrollColumn: target.scrollColumn,
      targetHorizontalAnchorOffset: target.horizontalAnchorOffset,
      targetScrollRow: target.scrollRow,
      targetVerticalAnchorOffset: target.verticalAnchorOffset,
    });
    if (columnWasAtTarget) {
      this.state.current.setState({
        scrollColumn: target.scrollColumn,
      });
    }
    if (horizontalAnchorWasAtTarget) {
      this.state.current.setState({
        horizontalAnchorOffset: target.horizontalAnchorOffset,
      });
    }
    if (rowWasAtTarget) {
      this.state.current.setState({ scrollRow: target.scrollRow });
    }
    if (verticalAnchorWasAtTarget) {
      this.state.current.setState({
        verticalAnchorOffset: target.verticalAnchorOffset,
      });
    }
    this.state.current.setState(this.createSnapshot());
  }

  private setCursor(
    cursor: WorkspaceGridCursor,
    scene: WorkspaceScene = this.toScene(),
  ): void {
    this.state.current.setState({
      cursor: normalizeWorkspaceGridCursor(scene, cursor),
    });
    this.initialCursorCameraPending = false;
    this.focusRevealSuppressed = false;
    this.paneRearrangement.clearWithoutNotify();
    this.retargetCameraForCursor();
  }

  private setCursorForPane(paneId: PaneId): void {
    const cursor = workspaceGridCursorForPane(this.toScene(), paneId);
    if (!cursor) {
      return;
    }
    this.setCursor(cursor);
  }

  private setCursorForPaneWithoutCamera(paneId: PaneId): void {
    const cursor = workspaceGridCursorForPane(this.toScene(), paneId);
    if (!cursor) {
      return;
    }
    this.state.current.setState({
      cursor: normalizeWorkspaceGridCursor(this.toScene(), cursor),
    });
    this.initialCursorCameraPending = false;
    this.focusRevealSuppressed = true;
  }

  private holdCameraPosition(): void {
    this.state.current.setState({
      targetScrollColumn: this.getSnapshot().scrollColumn,
      targetHorizontalAnchorOffset: this.getSnapshot().horizontalAnchorOffset,
      targetScrollRow: this.getSnapshot().scrollRow,
      targetVerticalAnchorOffset: this.getSnapshot().verticalAnchorOffset,
    });
    this.overviewCamera.targetOverviewProgress =
      this.overviewCamera.overviewProgress;
  }

  private exitOverviewToFocusedPane(): void {
    this.overviewCamera.exit();
    this.focusRevealSuppressed = false;
    const target = this.cursorCameraTarget();
    this.state.current.setState({
      scrollColumn: target.scrollColumn,
      targetScrollColumn: target.scrollColumn,
      horizontalAnchorOffset: target.horizontalAnchorOffset,
      targetHorizontalAnchorOffset: target.horizontalAnchorOffset,
      scrollRow: target.scrollRow,
      targetScrollRow: target.scrollRow,
      verticalAnchorOffset: target.verticalAnchorOffset,
      targetVerticalAnchorOffset: target.verticalAnchorOffset,
    });
    this.notify(false);
  }

  private retargetCameraForCursor(
    focusAnchor: WorkspaceFocusAnchor = this.getSnapshot().focusAnchor,
  ): void {
    if (this.overviewCamera.mode === "overview") {
      this.retargetOverviewFollowCamera();
      return;
    }
    const target = this.cursorCameraTarget(focusAnchor);
    const state = this.getSnapshot();
    this.state.current.setState({
      targetScrollColumn: target.scrollColumn,
      targetScrollRow: target.scrollRow,
      targetVerticalAnchorOffset: target.verticalAnchorOffset,
      targetHorizontalAnchorOffset: target.horizontalAnchorOffset,
      scrollColumn:
        Math.abs(state.scrollColumn - target.scrollColumn) < 0.001
          ? target.scrollColumn
          : state.scrollColumn,
      scrollRow: workspaceScrollRowIsSettled(state.scrollRow, target.scrollRow)
        ? target.scrollRow
        : state.scrollRow,
      horizontalAnchorOffset:
        Math.abs(state.horizontalAnchorOffset - target.horizontalAnchorOffset) <
        0.001
          ? target.horizontalAnchorOffset
          : state.horizontalAnchorOffset,
      verticalAnchorOffset:
        Math.abs(state.verticalAnchorOffset - target.verticalAnchorOffset) <
        0.001
          ? target.verticalAnchorOffset
          : state.verticalAnchorOffset,
    });
    this.state.current.setState(this.createSnapshot());
  }

  private cursorCameraTarget(
    focusAnchor: WorkspaceFocusAnchor = this.getSnapshot().focusAnchor,
  ) {
    return this.engine.gridCameraTarget(
      this.getSnapshot().cursor,
      this.lastViewport,
      focusAnchor,
      this.getSnapshot().maximizedPaneId,
    );
  }

  private overviewCameraInput() {
    return {
      cameraMode: this.cameraModesByPresentation.overview,
      cursor: this.getSnapshot().cursor,
      engine: this.engine,
      maximizedPaneId: this.getSnapshot().maximizedPaneId,
      viewport: this.lastViewport,
    };
  }

  private retargetOverviewFollowCamera(): void {
    this.overviewCamera.followCursorAtStableScale(this.overviewCameraInput());
    this.state.current.setState(this.createSnapshot());
  }
}
