import type { WorkspaceLikeLayoutEngine } from "../layout/layout-engine.js";
import { WorkspaceOverviewCamera } from "../layout/overview-camera.js";
import type {
  ColumnId,
  PaneId,
  Rect,
  WorkspaceCameraModes,
  WorkspaceFocusAnchor,
  WorkspaceGridCursor,
  WorkspaceScene,
} from "../types.js";
import { defaultWorkspaceCameraModes } from "../types.js";
import {
  normalizeWorkspaceGridCursor,
  workspaceColumnAtGridCursor,
  workspaceGridCursorForPane,
  workspaceGridCursorsEqual,
} from "../workspace/workspace-grid-cursor.js";
import {
  WorkspaceCameraMotion,
  workspaceScrollRowIsSettled,
} from "./layout-store-animation.js";
import { PaneRearrangementController } from "./layout-store-rearrangement.js";
import {
  type PaneResizeAxis,
  type PaneResizeFixedEdge,
} from "./layout-store-sizing.js";
import { createWorkspaceState } from "./layout-store-state.js";
import type { WorkspaceLayoutSnapshot } from "./layout-store-types.js";

const defaultViewportHeight = 900;

export abstract class WorkspaceLayoutCamera {
  protected abstract readonly state: ReturnType<typeof createWorkspaceState>;
  protected abstract readonly engine: WorkspaceLikeLayoutEngine;
  protected abstract readonly paneRearrangement: PaneRearrangementController;
  protected abstract createSnapshot(
    scene?: WorkspaceScene,
  ): WorkspaceLayoutSnapshot;
  protected abstract notify(
    layoutChanged?: boolean,
    kind?: WorkspaceLayoutSnapshot["layoutChangeKind"],
  ): void;
  abstract toScene(): WorkspaceScene;
  abstract clearPaneRearrangementSource(): void;
  protected cameraModesByPresentation: WorkspaceCameraModes = {
    ...defaultWorkspaceCameraModes,
  };

  protected readonly cameraMotion = new WorkspaceCameraMotion();

  protected focusRevealSuppressed = false;

  protected initialCursorCameraPending = true;

  protected readonly overviewCamera = new WorkspaceOverviewCamera();

  protected lastViewport: Rect = {
    height: defaultViewportHeight,
    width: 1200,
    x: 0,
    y: 0,
  };

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

  getSnapshot(): WorkspaceLayoutSnapshot {
    return this.state.current.getState();
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

  reanchorResizedRow(paneId: PaneId): void {
    const state = this.getSnapshot();
    if (
      this.overviewCamera.mode !== "normal" ||
      state.focusedPaneId === null ||
      this.focusCameraIsSuppressed() ||
      workspaceGridCursorForPane(this.toScene(), paneId)?.row !==
        state.cursor.row
    ) {
      return;
    }
    const target = this.cursorCameraTarget();
    if (
      state.verticalAnchorOffset === target.verticalAnchorOffset &&
      state.targetVerticalAnchorOffset === target.verticalAnchorOffset
    ) {
      return;
    }
    const settled =
      Math.abs(state.verticalAnchorOffset - state.targetVerticalAnchorOffset) <=
      0.001;
    this.state.current.setState({
      targetVerticalAnchorOffset: target.verticalAnchorOffset,
      ...(settled ? { verticalAnchorOffset: target.verticalAnchorOffset } : {}),
    });
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

  startAtPane(paneId: PaneId): boolean {
    const scene = this.toScene();
    const cursor = workspaceGridCursorForPane(scene, paneId);
    if (!cursor) {
      return false;
    }
    if (workspaceGridCursorsEqual(cursor, this.getSnapshot().cursor)) {
      return true;
    }
    this.state.current.setState({
      cursor: normalizeWorkspaceGridCursor(scene, cursor),
    });
    this.focusRevealSuppressed = false;
    this.paneRearrangement.clearWithoutNotify();
    this.retargetCameraForCursor(
      this.initialCursorCameraPending ? "center" : undefined,
    );
    this.cameraMotion.reset();
    this.snapScrollToTarget();
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

  protected updateViewportAfterSizing(viewport: Rect): void {
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
    if (this.focusCameraIsSuppressed()) {
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

  protected focusCameraIsSuppressed(): boolean {
    return (
      this.focusRevealSuppressed && this.getSnapshot().focusAnchor !== "center"
    );
  }

  protected setCursor(
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

  protected setCursorForPane(paneId: PaneId): void {
    const cursor = workspaceGridCursorForPane(this.toScene(), paneId);
    if (!cursor) {
      return;
    }
    this.setCursor(cursor);
  }

  protected setCursorForPaneWithoutCamera(paneId: PaneId): void {
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

  protected paneResizeEdge(
    paneId: PaneId,
    axis: PaneResizeAxis,
    edge: PaneResizeFixedEdge,
  ): number | null {
    const scene = this.toScene();
    const cursor = workspaceGridCursorForPane(scene, paneId);
    if (!cursor) {
      return null;
    }
    const cells = workspaceColumnAtGridCursor(scene, cursor)?.cells.length ?? 1;
    const box = this.engine.gridCursorRenderItem({
      ...this.getSnapshot(),
      cursor:
        axis === "row"
          ? { ...cursor, split: edge === "start" ? 0 : Math.max(0, cells - 1) }
          : cursor,
      movementPhase: "idle",
      presentationMode: "normal",
      viewport: this.lastViewport,
    });
    return axis === "column"
      ? box.x + (edge === "end" ? box.width : 0)
      : box.y + (edge === "end" ? box.height : 0);
  }

  protected offsetNormalCamera(axis: PaneResizeAxis, delta: number): void {
    if (this.overviewCamera.mode !== "normal" || !Number.isFinite(delta)) {
      return;
    }
    const snapshot = this.getSnapshot();
    this.state.current.setState(
      axis === "column"
        ? {
            horizontalAnchorOffset: snapshot.horizontalAnchorOffset + delta,
            targetHorizontalAnchorOffset:
              snapshot.targetHorizontalAnchorOffset + delta,
          }
        : {
            verticalAnchorOffset: snapshot.verticalAnchorOffset + delta,
            targetVerticalAnchorOffset:
              snapshot.targetVerticalAnchorOffset + delta,
          },
    );
  }

  protected holdCameraPosition(): void {
    this.state.current.setState({
      targetScrollColumn: this.getSnapshot().scrollColumn,
      targetHorizontalAnchorOffset: this.getSnapshot().horizontalAnchorOffset,
      targetScrollRow: this.getSnapshot().scrollRow,
      targetVerticalAnchorOffset: this.getSnapshot().verticalAnchorOffset,
    });
    this.overviewCamera.targetOverviewProgress =
      this.overviewCamera.overviewProgress;
  }

  protected exitOverviewToFocusedPane(): void {
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

  protected retargetCameraForCursor(
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

  protected cursorCameraTarget(
    focusAnchor: WorkspaceFocusAnchor = this.getSnapshot().focusAnchor,
  ) {
    return this.engine.gridCameraTarget(
      this.getSnapshot().cursor,
      this.lastViewport,
      focusAnchor,
      this.getSnapshot().maximizedPaneId,
    );
  }

  protected overviewCameraInput() {
    return {
      cameraMode: this.cameraModesByPresentation.overview,
      cursor: this.getSnapshot().cursor,
      engine: this.engine,
      maximizedPaneId: this.getSnapshot().maximizedPaneId,
      viewport: this.lastViewport,
    };
  }

  protected retargetOverviewFollowCamera(): void {
    this.overviewCamera.followCursorAtStableScale(this.overviewCameraInput());
    this.state.current.setState(this.createSnapshot());
  }
}
