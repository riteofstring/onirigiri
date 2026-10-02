import type { WorkspaceLikeLayoutEngine } from "./layout-engine.js";
import {
  OVERVIEW_MAX_ZOOM_SCALE,
  OVERVIEW_MIN_ZOOM,
} from "./layout-engine-helpers.js";
import { clampPan, clampRange } from "../state/layout-store-helpers.js";
import type {
  PaneId,
  Rect,
  WorkspaceCameraMode,
  WorkspaceGridCursor,
  WorkspacePresentationMode,
} from "../types.js";

const overviewBaselineZoom = 1.8;
const fixedOverviewMaximumScale = 0.68;

interface OverviewCameraState {
  fixedScale?: number;
  panX: number;
  panY: number;
  zoom: number;
}

interface OverviewCameraInput extends OverviewCameraState {
  cursor: WorkspaceGridCursor;
  engine: WorkspaceLikeLayoutEngine;
  maximizedPaneId: PaneId | null;
  viewport: Rect;
}

interface OverviewPanInput extends OverviewCameraInput {
  deltaX: number;
  deltaY: number;
}

interface OverviewZoomInput extends OverviewCameraInput {
  focalX: number;
  focalY: number;
  zoomFactor: number;
}

interface OverviewCameraModeInput {
  cameraMode: WorkspaceCameraMode;
  cursor: WorkspaceGridCursor;
  engine: WorkspaceLikeLayoutEngine;
  maximizedPaneId: PaneId | null;
  viewport: Rect;
}

interface OverviewCameraPanRequest extends Omit<
  OverviewCameraModeInput,
  "cameraMode"
> {
  deltaX: number;
  deltaY: number;
}

function panOverviewCamera(
  input: OverviewPanInput,
): OverviewCameraState | null {
  const bounds = input.engine.overviewContentBounds(
    input.viewport,
    input.maximizedPaneId,
    input.zoom,
    input.cursor,
    input.fixedScale,
  );
  const panX = clampPan(input.panX + input.deltaX, bounds.maxPanX);
  const panY = clampPan(input.panY + input.deltaY, bounds.maxPanY);
  return panX === input.panX && panY === input.panY
    ? null
    : { panX, panY, zoom: input.zoom };
}

function zoomOverviewCamera(
  input: OverviewZoomInput,
): OverviewCameraState | null {
  if (!Number.isFinite(input.zoomFactor) || input.zoomFactor <= 0) {
    return null;
  }
  const before = input.engine.overviewContentBounds(
    input.viewport,
    input.maximizedPaneId,
    input.zoom,
    input.cursor,
    input.fixedScale,
  );
  if (before.fitScale <= 0 || before.scale <= 0) {
    return null;
  }
  const maximumScale =
    input.fixedScale === undefined
      ? OVERVIEW_MAX_ZOOM_SCALE
      : fixedOverviewMaximumScale;
  const fixedScale =
    input.fixedScale === undefined
      ? undefined
      : clampRange(
          before.scale * input.zoomFactor,
          before.fitScale * OVERVIEW_MIN_ZOOM,
          Math.max(before.fitScale, maximumScale),
        );
  const maxZoom = Math.max(1, maximumScale / before.fitScale);
  const zoom = clampRange(
    input.zoom * input.zoomFactor,
    OVERVIEW_MIN_ZOOM,
    maxZoom,
  );
  if (
    fixedScale === undefined
      ? Math.abs(zoom - input.zoom) < 0.0001
      : Math.abs(fixedScale - before.scale) < 0.0001
  ) {
    return null;
  }
  const surfaceX =
    (input.focalX - (before.baseXOffset - input.panX)) / before.scale;
  const surfaceY =
    (input.focalY - (before.baseYOffset - input.panY)) / before.scale;
  const after = input.engine.overviewContentBounds(
    input.viewport,
    input.maximizedPaneId,
    zoom,
    input.cursor,
    fixedScale,
  );
  return {
    fixedScale,
    panX: clampPan(
      after.baseXOffset + surfaceX * after.scale - input.focalX,
      after.maxPanX,
    ),
    panY: clampPan(
      after.baseYOffset + surfaceY * after.scale - input.focalY,
      after.maxPanY,
    ),
    zoom,
  };
}

export class WorkspaceOverviewCamera {
  private fixedScale: number | null = null;
  private followOffsetX = 0;
  private followOffsetY = 0;
  private panX = 0;
  private panY = 0;
  private presentationMode: WorkspacePresentationMode = "normal";
  private progress = 0;
  private targetProgress = 0;
  private zoom = 1;

  get mode(): WorkspacePresentationMode {
    return this.presentationMode;
  }

  get overviewFollowOffsetX(): number {
    return this.followOffsetX;
  }

  get overviewFollowOffsetY(): number {
    return this.followOffsetY;
  }

  get overviewFixedScale(): number | undefined {
    return this.fixedScale ?? undefined;
  }

  get overviewPanX(): number {
    return this.panX;
  }

  get overviewPanY(): number {
    return this.panY;
  }

  get overviewProgress(): number {
    return this.progress;
  }

  get overviewZoom(): number {
    return this.zoom;
  }

  get targetOverviewProgress(): number {
    return this.targetProgress;
  }

  set targetOverviewProgress(progress: number) {
    this.targetProgress = progress;
  }

  applyFollowOffset(offset: { x: number; y: number }): void {
    this.followOffsetX += offset.x;
    this.followOffsetY += offset.y;
  }

  setProgress(progress: number): void {
    this.progress = progress;
  }

  enter(input: OverviewCameraModeInput): void {
    this.presentationMode = "overview";
    this.targetProgress = 1;
    this.resetCamera();
    this.configureForMode(input);
  }

  configureForMode(input: OverviewCameraModeInput): void {
    if (this.presentationMode !== "overview") {
      return;
    }
    this.resetCamera();
    if (input.cameraMode === "follow") {
      this.followCursorAtStableScale(input);
    } else {
      this.zoom = this.followOverviewBaselineZoom(input);
    }
  }

  exit(): void {
    this.presentationMode = "normal";
    this.targetProgress = 0;
  }

  pan({
    cursor,
    deltaX,
    deltaY,
    engine,
    maximizedPaneId,
    viewport,
  }: OverviewCameraPanRequest): boolean {
    const camera = panOverviewCamera({
      deltaX,
      deltaY,
      cursor,
      engine,
      maximizedPaneId,
      panX: this.panX,
      panY: this.panY,
      fixedScale: this.fixedScale ?? undefined,
      viewport,
      zoom: this.zoom,
    });
    if (!camera) {
      return false;
    }
    this.panX = camera.panX;
    this.panY = camera.panY;
    return true;
  }

  reset(): void {
    this.fixedScale = null;
    this.followOffsetX = 0;
    this.followOffsetY = 0;
    this.panX = 0;
    this.panY = 0;
    this.presentationMode = "normal";
    this.progress = 0;
    this.targetProgress = 0;
    this.zoom = 1;
  }

  resetCameraAfterExit(): void {
    if (this.presentationMode === "normal" && this.progress <= 0.001) {
      this.resetCamera();
    }
  }

  snapProgressToTarget(): void {
    this.progress = this.targetProgress;
  }

  zoomBy({
    cursor,
    engine,
    focalX,
    focalY,
    maximizedPaneId,
    viewport,
    zoomFactor,
  }: Omit<OverviewZoomInput, "panX" | "panY" | "zoom">): boolean {
    const camera = zoomOverviewCamera({
      cursor,
      engine,
      focalX,
      focalY,
      maximizedPaneId,
      panX: this.panX,
      panY: this.panY,
      fixedScale: this.fixedScale ?? undefined,
      viewport,
      zoom: this.zoom,
      zoomFactor,
    });
    if (!camera) {
      return false;
    }
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.zoom = camera.zoom;
    if (this.fixedScale !== null) {
      this.fixedScale = camera.fixedScale ?? this.fixedScale;
    }
    return true;
  }

  followCursorAtStableScale(input: OverviewCameraModeInput): void {
    if (this.presentationMode !== "overview" || input.cameraMode !== "follow") {
      return;
    }
    if (this.fixedScale === null) {
      const baseline = input.engine.overviewContentBounds(
        input.viewport,
        input.maximizedPaneId,
        1,
        input.cursor,
      );
      this.fixedScale = Math.max(baseline.fitScale, fixedOverviewMaximumScale);
      this.zoom = clampRange(
        this.fixedScale / baseline.fitScale,
        OVERVIEW_MIN_ZOOM,
        Math.max(1, fixedOverviewMaximumScale / baseline.fitScale),
      );
    }
    const cursor = input.engine.gridCursorRenderItem({
      cursor: input.cursor,
      focusedPaneId: null,
      maximizedPaneId: input.maximizedPaneId,
      movementPhase: "idle",
      overviewPanX: this.panX,
      overviewPanY: this.panY,
      overviewFixedScale: this.fixedScale,
      overviewZoom: this.zoom,
      presentationMode: "overview",
      scrollColumn: 0,
      scrollRow: 0,
      viewport: input.viewport,
    });
    this.followOffsetX =
      input.viewport.x +
      input.viewport.width / 2 -
      (cursor.x + (cursor.width * cursor.scale) / 2);
    this.followOffsetY =
      input.viewport.y +
      input.viewport.height / 2 -
      (cursor.y + (cursor.height * cursor.scale) / 2);
  }

  private followOverviewBaselineZoom(input: OverviewCameraModeInput): number {
    const baseline = input.engine.overviewContentBounds(
      input.viewport,
      input.maximizedPaneId,
      1,
      input.cursor,
    );
    return clampRange(
      overviewBaselineZoom,
      1,
      Math.max(1, OVERVIEW_MAX_ZOOM_SCALE / baseline.fitScale),
    );
  }

  private resetCamera(): void {
    this.fixedScale = null;
    this.followOffsetX = 0;
    this.followOffsetY = 0;
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
  }
}
