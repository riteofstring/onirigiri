import {
  overviewCameraCanRetarget,
  sameOverviewCameraFrame,
} from "./workspace-overview-camera-state.js";
import { AnimationClock, type AnimationFrameHost } from "./animation-clock.js";
import type { WorkspaceLikeLayoutEngine } from "../layout/layout-engine.js";
import { workspaceScrollRowIsSettled } from "../state/layout-store-animation.js";
import type {
  WorkspaceLayoutSnapshot,
  WorkspaceLayoutStore,
  WorkspacePaneRearrangementSource,
} from "../state/layout-store.js";
import type {
  PanePresentationWriteCounts,
  PanePresentationEngine,
} from "./pane-presentation-engine.js";
import type {
  OnirigiriFocusHighlightMotion,
  OnirigiriMotionCurve,
  PaneRenderItem,
  Rect,
  ReservedCellRenderItem,
  WorkspaceCameraMode,
  WorkspaceWorldFrame,
} from "../types.js";
import { workspaceGridCursorsEqual } from "../workspace/workspace-grid-cursor.js";
import type { WorkspaceGridCursorPresentation } from "../workspace/workspace-grid-cursor-presentation.js";
import type { WorkspaceWorldPresentation } from "./workspace-world-presentation.js";
import type { WorkspaceMinimapPresentation } from "./workspace-minimap-presentation.js";
import {
  defaultCameraMotion,
  defaultFocusHighlightMotion,
  type ResolvedCameraMotion,
} from "./motion-curve.js";
import {
  workspaceMotionSceneItems,
  WorkspaceMotionSceneInventory,
} from "./workspace-motion-scene-inventory.js";
import { workspacePaneRearrangementSweep } from "./workspace-pane-rearrangement-sweep.js";
import {
  workspaceGridCursorRenderItem,
  workspaceRenderItems,
  workspaceReservedCellRenderItems,
  WorkspaceRenderItemRenderer,
  WorkspaceWorldFrameRenderer,
} from "./workspace-render-items.js";

type WorkspaceFrameBoundary = "request" | "settle";

interface WorkspaceFrameSample {
  moving: boolean;
  timestamp: number;
  writes: PanePresentationWriteCounts;
}

interface MotionActivity {
  active: boolean;
  wasActive: boolean;
}

interface WorkspaceFrameMotion {
  cursor: MotionActivity;
  moving: boolean;
  overviewCamera: MotionActivity;
  paneRearrangement: MotionActivity;
}

interface WorkspaceFrameSchedulerOptions {
  compactLayoutProvider: () => boolean;
  cursorPresentation?: WorkspaceGridCursorPresentation;
  engine: WorkspaceLikeLayoutEngine;
  frameHost?: AnimationFrameHost;
  minimapPresentation?: WorkspaceMinimapPresentation;
  motionProvider?: () => WorkspaceFrameMotionOptions;
  onBoundary: (
    snapshot: WorkspaceLayoutSnapshot,
    boundary: WorkspaceFrameBoundary,
    frame: WorkspacePresentationBoundaryFrame | null,
  ) => void;
  onFrame?: (sample: WorkspaceFrameSample) => void;
  onPresentation?: (frame: WorkspacePresentationBoundaryFrame) => void;
  presentation: PanePresentationEngine;
  reducedMotionQuery?: MediaQueryList | null;
  store: WorkspaceLayoutStore;
  worldPresentation?: WorkspaceWorldPresentation;
  viewportProvider: () => Rect;
}

export interface WorkspaceFrameMotionOptions {
  camera: ResolvedCameraMotion;
  highlight: OnirigiriFocusHighlightMotion;
}

const defaultFrameMotionOptions: WorkspaceFrameMotionOptions = {
  camera: defaultCameraMotion,
  highlight: defaultFocusHighlightMotion,
};

export interface WorkspacePresentationBoundaryFrame {
  items: readonly PaneRenderItem[];
  reservedCells: readonly ReservedCellRenderItem[];
  snapshot: WorkspaceLayoutSnapshot;
  world: WorkspaceWorldFrame;
}

export class WorkspaceFrameScheduler {
  private readonly clock: AnimationClock;
  private readonly renderer = new WorkspaceRenderItemRenderer();
  private readonly worldFrameRenderer = new WorkspaceWorldFrameRenderer();
  private readonly motionSceneInventory = new WorkspaceMotionSceneInventory();
  private destroyed = false;
  private cursorMotionInitialFramePending = false;
  private frameRequestSequence = 0;
  private lastBoundaryMoving: boolean;
  private lastBoundarySnapshot: WorkspaceLayoutSnapshot;
  private lastCursorGeometrySnapshot: WorkspaceLayoutSnapshot;
  private lastRenderedItems: readonly PaneRenderItem[] = [];
  private lastOverviewCameraMode: WorkspaceCameraMode;
  private lastOverviewCameraSnapshot: WorkspaceLayoutSnapshot;
  private lastPresentationBoundaryFrame: WorkspacePresentationBoundaryFrame | null =
    null;
  private lastPresentedMoving: boolean;
  private overviewCameraMotionInitialFramePending = false;
  private activePaneRearrangementSource: WorkspacePaneRearrangementSource | null =
    null;
  private pendingOverviewCameraBoundary: WorkspaceLayoutSnapshot | null = null;
  private pendingOverviewCameraBoundaryFrameCount = 0;
  private paneRearrangementInitialFramePending = false;
  private renderedFrameRequestSequence = 0;
  private started = false;
  private unsubscribeStore: (() => void) | null = null;

  constructor(private readonly options: WorkspaceFrameSchedulerOptions) {
    this.lastBoundarySnapshot = options.store.getSnapshot();
    this.lastCursorGeometrySnapshot = this.lastBoundarySnapshot;
    this.lastOverviewCameraMode = options.store.cameraMode();
    this.lastOverviewCameraSnapshot = this.lastBoundarySnapshot;
    this.lastBoundaryMoving = workspaceSnapshotIsMoving(
      this.lastBoundarySnapshot,
    );
    this.lastPresentedMoving = this.lastBoundaryMoving;
    this.clock = new AnimationClock(this.tick, options.frameHost);
  }

  start(): void {
    if (this.started || this.destroyed) {
      return;
    }
    this.started = true;
    this.unsubscribeStore = this.options.store.subscribe(
      this.handleStoreChange,
    );
    this.options.reducedMotionQuery?.addEventListener(
      "change",
      this.handleReducedMotionChange,
    );
    if (this.prefersReducedMotion()) {
      this.options.store.snapAnimationsToTarget();
      this.options.presentation.snapPaneRearrangement();
      this.options.cursorPresentation?.snapMotion();
      this.options.worldPresentation?.snapMotion();
      this.paneRearrangementInitialFramePending = false;
      this.cursorMotionInitialFramePending = false;
      this.overviewCameraMotionInitialFramePending = false;
      this.clearActivePaneRearrangementSource();
      this.lastOverviewCameraSnapshot = this.options.store.getSnapshot();
      this.publishBoundary(this.options.store.getSnapshot(), "settle");
    }
    this.requestFrame();
  }

  requestFrame(): void {
    if (this.destroyed) {
      return;
    }
    this.frameRequestSequence += 1;
    if (this.started) {
      this.clock.start();
    }
  }

  teardown(): void {
    this.destroyed = true;
    this.started = false;
    this.clock.stop();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.options.reducedMotionQuery?.removeEventListener(
      "change",
      this.handleReducedMotionChange,
    );
    this.clearPendingOverviewCameraBoundary();
    this.clearActivePaneRearrangementSource();
    this.renderer.reset();
    this.worldFrameRenderer.reset();
  }

  private readonly handleStoreChange = (
    snapshot: WorkspaceLayoutSnapshot,
  ): void => {
    let currentSnapshot = snapshot;
    if (this.prefersReducedMotion()) {
      if (
        currentSnapshot.paneRearrangementRevision !==
        this.lastBoundarySnapshot.paneRearrangementRevision
      ) {
        currentSnapshot = this.retargetPaneRearrangement(currentSnapshot);
      }
      this.options.store.snapAnimationsToTarget();
      this.options.presentation.snapPaneRearrangement();
      this.options.cursorPresentation?.snapMotion();
      this.options.worldPresentation?.snapMotion();
      this.paneRearrangementInitialFramePending = false;
      this.cursorMotionInitialFramePending = false;
      this.overviewCameraMotionInitialFramePending = false;
      this.clearActivePaneRearrangementSource();
      this.lastCursorGeometrySnapshot = this.options.store.getSnapshot();
      this.lastOverviewCameraMode = this.options.store.cameraMode();
      this.lastOverviewCameraSnapshot = this.options.store.getSnapshot();
      this.clearPendingOverviewCameraBoundary();
      this.publishBoundary(this.options.store.getSnapshot(), "settle");
      this.requestFrame();
      return;
    }
    if (
      currentSnapshot.paneRearrangementRevision !==
      this.lastBoundarySnapshot.paneRearrangementRevision
    ) {
      currentSnapshot = this.retargetPaneRearrangement(currentSnapshot);
    }
    this.retargetOverviewCamera(currentSnapshot);
    this.retargetCursor(currentSnapshot);
    const moving = workspaceSnapshotIsMoving(currentSnapshot);
    if (this.shouldDeferOverviewCameraBoundary(currentSnapshot, moving)) {
      this.deferOverviewCameraBoundary(currentSnapshot);
    } else if (this.shouldPublishRequestBoundary(currentSnapshot, moving)) {
      this.clearPendingOverviewCameraBoundary();
      this.publishBoundary(currentSnapshot, "request");
    }
    this.requestFrame();
  };

  private readonly handleReducedMotionChange = (): void => {
    if (this.prefersReducedMotion()) {
      this.options.store.snapAnimationsToTarget();
      this.options.presentation.snapPaneRearrangement();
      this.options.cursorPresentation?.snapMotion();
      this.options.worldPresentation?.snapMotion();
      this.paneRearrangementInitialFramePending = false;
      this.cursorMotionInitialFramePending = false;
      this.overviewCameraMotionInitialFramePending = false;
      this.clearActivePaneRearrangementSource();
      this.lastCursorGeometrySnapshot = this.options.store.getSnapshot();
      this.lastOverviewCameraMode = this.options.store.cameraMode();
      this.lastOverviewCameraSnapshot = this.options.store.getSnapshot();
      this.clearPendingOverviewCameraBoundary();
      this.publishBoundary(this.options.store.getSnapshot(), "settle");
    }
    this.requestFrame();
  };

  private readonly tick = (timestamp: number, deltaMs: number): void => {
    const requestSequenceAtFrameStart = this.frameRequestSequence;
    this.advanceStoreFrame(deltaMs);
    const snapshot = this.options.store.getSnapshot();
    this.lastOverviewCameraMode = this.options.store.cameraMode();
    this.lastOverviewCameraSnapshot = snapshot;
    const motion = this.advanceFrameMotion(snapshot, deltaMs);
    const writes = this.presentFrame(snapshot, motion);
    this.completeFrame(
      snapshot,
      motion,
      timestamp,
      writes,
      requestSequenceAtFrameStart,
    );
  };

  private presentFrame(
    snapshot: WorkspaceLayoutSnapshot,
    motion: WorkspaceFrameMotion,
  ): PanePresentationWriteCounts {
    const viewport = this.options.viewportProvider();
    const compactLayout = this.options.compactLayoutProvider();
    const renderInput = {
      compactLayout,
      engine: this.options.engine,
      moving: motion.moving,
      snapshot,
      sweepGrid: this.options.worldPresentation?.activeMotionGrid(),
      viewport,
    };
    const items = workspacePaneRearrangementSweep(
      renderInput,
      this.renderer.render(renderInput),
      this.activePaneRearrangementSource,
    ).items;
    const cursor = this.renderCursorForSnapshot(snapshot, motion.moving);
    const writes = this.options.presentation.apply(
      items,
      snapshot,
      compactLayout,
      viewport,
    );
    const worldFrame = this.renderWorldFrameForSnapshot(
      snapshot,
      motion.moving,
    );
    const presentedWorldFrame =
      this.options.worldPresentation?.apply(worldFrame, motion.moving) ??
      worldFrame;
    this.options.cursorPresentation?.apply(
      cursor,
      motion.moving,
      this.options.worldPresentation?.presentedScale(worldFrame.scale) ??
        worldFrame.scale,
    );
    this.options.minimapPresentation?.apply(
      items,
      presentedWorldFrame,
      viewport,
    );
    this.lastPresentationBoundaryFrame = {
      items,
      reservedCells: workspaceReservedCellRenderItems(renderInput),
      snapshot,
      world: presentedWorldFrame,
    };
    this.lastRenderedItems = items;
    this.options.onPresentation?.(this.lastPresentationBoundaryFrame);
    return writes;
  }

  private completeFrame(
    snapshot: WorkspaceLayoutSnapshot,
    motion: WorkspaceFrameMotion,
    timestamp: number,
    writes: PanePresentationWriteCounts,
    requestSequenceAtFrameStart: number,
  ): void {
    if (
      motion.paneRearrangement.wasActive &&
      !motion.paneRearrangement.active
    ) {
      this.clearActivePaneRearrangementSource();
    }
    this.paneRearrangementInitialFramePending = false;
    this.cursorMotionInitialFramePending = false;
    this.overviewCameraMotionInitialFramePending = false;
    this.options.onFrame?.({ moving: motion.moving, timestamp, writes });
    const movementWasRequested =
      this.lastPresentedMoving || this.lastBoundaryMoving;
    if (movementWasRequested && !motion.moving) {
      this.publishBoundary(snapshot, "settle");
    }
    this.publishDeferredOverviewCameraBoundary(snapshot, motion.moving);
    this.lastPresentedMoving = motion.moving;
    this.renderedFrameRequestSequence = Math.max(
      this.renderedFrameRequestSequence,
      requestSequenceAtFrameStart,
    );
    const requestPending =
      this.renderedFrameRequestSequence < this.frameRequestSequence;
    if (!this.shouldContinueClock(motion, requestPending)) {
      this.clock.stop();
    }
  }

  private advanceFrameMotion(
    snapshot: WorkspaceLayoutSnapshot,
    deltaMs: number,
  ): WorkspaceFrameMotion {
    const paneRearrangement = this.advancePaneRearrangement(deltaMs);
    const cursor = this.advanceCursorMotion(deltaMs);
    const overviewCamera = this.advanceOverviewCameraMotion(deltaMs);
    const moving = [
      workspaceSnapshotIsMoving(snapshot),
      paneRearrangement.wasActive,
      cursor.wasActive,
      overviewCamera.wasActive,
    ].some(Boolean);
    return { cursor, moving, overviewCamera, paneRearrangement };
  }

  private advanceStoreFrame(deltaMs: number): void {
    if (this.prefersReducedMotion()) {
      this.options.store.snapAnimationsToTarget();
      this.options.presentation.snapPaneRearrangement();
      this.options.cursorPresentation?.snapMotion();
      this.options.worldPresentation?.snapMotion();
      return;
    }
    this.options.store.advanceFrame(deltaMs);
  }

  private advancePaneRearrangement(deltaMs: number): {
    active: boolean;
    wasActive: boolean;
  } {
    const wasActive = this.options.presentation.hasActivePaneRearrangement();
    if (!wasActive || this.paneRearrangementInitialFramePending) {
      return { active: wasActive, wasActive };
    }
    return {
      active: this.options.presentation.advancePaneRearrangement(deltaMs),
      wasActive,
    };
  }

  private advanceCursorMotion(deltaMs: number): {
    active: boolean;
    wasActive: boolean;
  } {
    const cursorPresentation = this.options.cursorPresentation;
    const wasActive = cursorPresentation?.hasActiveMotion() ?? false;
    if (!wasActive || this.cursorMotionInitialFramePending) {
      return { active: wasActive, wasActive };
    }
    return {
      active: cursorPresentation?.advanceMotion(deltaMs) ?? false,
      wasActive,
    };
  }

  private advanceOverviewCameraMotion(deltaMs: number): {
    active: boolean;
    wasActive: boolean;
  } {
    const worldPresentation = this.options.worldPresentation;
    const wasActive = worldPresentation?.hasActiveMotion() ?? false;
    if (!wasActive || this.overviewCameraMotionInitialFramePending) {
      return { active: wasActive, wasActive };
    }
    return {
      active: worldPresentation?.advanceMotion(deltaMs) ?? false,
      wasActive,
    };
  }

  private shouldContinueClock(
    motion: WorkspaceFrameMotion,
    requestPending: boolean,
  ): boolean {
    return [
      motion.moving,
      requestPending,
      motion.paneRearrangement.active,
      motion.cursor.active,
      motion.overviewCamera.active,
      this.pendingOverviewCameraBoundary !== null,
    ].some(Boolean);
  }

  private retargetPaneRearrangement(
    snapshot: WorkspaceLayoutSnapshot,
  ): WorkspaceLayoutSnapshot {
    let currentSnapshot = snapshot;
    this.activePaneRearrangementSource =
      this.options.store.paneRearrangementSourceFor(
        currentSnapshot.paneRearrangementRevision,
      );
    let rendered = this.renderItemsForSnapshot(currentSnapshot);
    let items = rendered.items;
    const focusedPaneId = currentSnapshot.focusedPaneId;
    if (
      this.activePaneRearrangementSource &&
      this.options.store.cameraMode() === "follow" &&
      currentSnapshot.presentationMode === "normal" &&
      focusedPaneId
    ) {
      const offset =
        this.options.presentation.followPaneRearrangementCameraOffset(
          items,
          focusedPaneId,
        );
      if (offset) {
        const worldFrame = this.renderWorldFrameForSnapshot(currentSnapshot);
        currentSnapshot = this.options.store.applyPaneRearrangementCameraOffset(
          {
            x: offset.x * worldFrame.scale,
            y: offset.y * worldFrame.scale,
          },
        );
        this.options.presentation.compensatePaneHostsForCameraOffset(offset);
        rendered = this.renderItemsForSnapshot(currentSnapshot);
        items = rendered.items;
      }
    }
    this.paneRearrangementInitialFramePending =
      this.options.presentation.retargetPaneRearrangement(
        this.motionSceneInventory.resolve(
          {
            compactLayout: this.options.compactLayoutProvider(),
            engine: this.options.engine,
            moving: false,
            snapshot: currentSnapshot,
            viewport: this.options.viewportProvider(),
          },
          items,
          this.renderer.worldBoxes({
            compactLayout: this.options.compactLayoutProvider(),
            engine: this.options.engine,
            moving: false,
            snapshot: currentSnapshot,
            viewport: this.options.viewportProvider(),
          }),
        ).items,
        [
          ...this.lastRenderedItems,
          ...rendered.sourceItems,
          ...this.sourceMotionSceneItems(),
        ],
      );
    if (!this.paneRearrangementInitialFramePending) {
      this.clearActivePaneRearrangementSource();
    }
    return currentSnapshot;
  }

  private retargetOverviewCamera(snapshot: WorkspaceLayoutSnapshot): void {
    const previous = this.lastOverviewCameraSnapshot;
    const previousMode = this.lastOverviewCameraMode;
    const nextMode = this.options.store.cameraMode();
    this.lastOverviewCameraSnapshot = snapshot;
    this.lastOverviewCameraMode = nextMode;
    if (
      !overviewCameraCanRetarget(
        previous,
        snapshot,
        previousMode,
        nextMode,
        !this.options.presentation.hasActivePaneRearrangement(),
      )
    ) {
      if (!sameOverviewCameraFrame(previous, snapshot)) {
        this.options.worldPresentation?.snapMotion();
        this.overviewCameraMotionInitialFramePending = false;
      }
      return;
    }
    this.overviewCameraMotionInitialFramePending =
      this.options.worldPresentation?.retarget(
        this.renderWorldFrameForSnapshot(previous),
        this.renderWorldFrameForSnapshot(snapshot),
        this.motionOptions().camera.overview,
      ) ?? false;
  }

  private retargetCursor(snapshot: WorkspaceLayoutSnapshot): void {
    const previous = this.lastCursorGeometrySnapshot;
    if (!this.cursorGeometryChanged(snapshot)) {
      return;
    }
    if (
      workspaceGridCursorsEqual(snapshot.cursor, previous.cursor) &&
      snapshot.maximizedPaneId === previous.maximizedPaneId &&
      snapshot.paneRearrangementRevision === previous.paneRearrangementRevision
    ) {
      this.options.cursorPresentation?.snapMotion();
      this.cursorMotionInitialFramePending = false;
      return;
    }
    const { curve, followsStoreCamera } = this.cursorMotion(snapshot);
    const retargeted =
      this.options.cursorPresentation?.retarget(
        this.renderCursorForSnapshot(
          snapshot,
          workspaceSnapshotIsMoving(snapshot),
        ),
        curve,
      ) ?? false;
    this.cursorMotionInitialFramePending = retargeted && !followsStoreCamera;
  }

  private cursorMotion(snapshot: WorkspaceLayoutSnapshot): {
    curve: OnirigiriMotionCurve;
    followsStoreCamera: boolean;
  } {
    const { camera, highlight } = this.motionOptions();
    if (highlight !== "camera") {
      return { curve: highlight, followsStoreCamera: false };
    }
    return snapshot.presentationMode === "overview"
      ? { curve: camera.overview, followsStoreCamera: false }
      : { curve: camera.navigation, followsStoreCamera: true };
  }

  private motionOptions(): WorkspaceFrameMotionOptions {
    return this.options.motionProvider?.() ?? defaultFrameMotionOptions;
  }

  private cursorGeometryChanged(snapshot: WorkspaceLayoutSnapshot): boolean {
    const previous = this.lastCursorGeometrySnapshot;
    const changed =
      !workspaceGridCursorsEqual(snapshot.cursor, previous.cursor) ||
      snapshot.layoutRevision !== previous.layoutRevision ||
      snapshot.maximizedPaneId !== previous.maximizedPaneId;
    this.lastCursorGeometrySnapshot = snapshot;
    return changed;
  }

  private renderItemsForSnapshot(snapshot: WorkspaceLayoutSnapshot) {
    const input = {
      compactLayout: this.options.compactLayoutProvider(),
      engine: this.options.engine,
      moving: false,
      snapshot,
      viewport: this.options.viewportProvider(),
    };
    return workspacePaneRearrangementSweep(
      input,
      this.renderer.render(input),
      this.activePaneRearrangementSource,
    );
  }

  private clearActivePaneRearrangementSource(): void {
    const source = this.activePaneRearrangementSource;
    if (!source) {
      return;
    }
    this.options.store.clearPaneRearrangementSource(source.revision);
    this.activePaneRearrangementSource = null;
  }

  private sourceMotionSceneItems(): PaneRenderItem[] {
    const source = this.activePaneRearrangementSource;
    if (!source) {
      return [];
    }
    const engine = this.options.engine.forkForWorldGeometry(source.scene);
    const input = {
      compactLayout: this.options.compactLayoutProvider(),
      engine,
      moving: false,
      snapshot: source.snapshot,
      viewport: this.options.viewportProvider(),
    };
    return workspaceMotionSceneItems(input, workspaceRenderItems(input));
  }

  private renderWorldFrameForSnapshot(
    snapshot: WorkspaceLayoutSnapshot,
    moving = false,
  ) {
    return this.worldFrameRenderer.render({
      compactLayout: this.options.compactLayoutProvider(),
      engine: this.options.engine,
      moving,
      snapshot,
      viewport: this.options.viewportProvider(),
    });
  }

  private renderCursorForSnapshot(
    snapshot: WorkspaceLayoutSnapshot,
    moving: boolean,
  ) {
    return workspaceGridCursorRenderItem({
      compactLayout: this.options.compactLayoutProvider(),
      engine: this.options.engine,
      moving,
      snapshot,
      viewport: this.options.viewportProvider(),
    });
  }

  private shouldPublishRequestBoundary(
    snapshot: WorkspaceLayoutSnapshot,
    moving: boolean,
  ): boolean {
    const previous = this.lastBoundarySnapshot;
    const focusChanged = [
      !workspaceGridCursorsEqual(snapshot.cursor, previous.cursor),
      snapshot.focusAnchor !== previous.focusAnchor,
    ].some(Boolean);
    const cameraTargetChanged = [
      snapshot.targetScrollColumn !== previous.targetScrollColumn,
      snapshot.targetHorizontalAnchorOffset !==
        previous.targetHorizontalAnchorOffset,
      snapshot.targetScrollRow !== previous.targetScrollRow,
      snapshot.targetVerticalAnchorOffset !==
        previous.targetVerticalAnchorOffset,
    ].some(Boolean);
    const cameraRequestChanged = focusChanged || cameraTargetChanged;
    const focusedPaneHostMissing =
      focusChanged &&
      snapshot.focusedPaneId !== null &&
      !this.options.presentation.hasPaneHost(snapshot.focusedPaneId);
    return [
      moving !== this.lastBoundaryMoving,
      snapshot.layoutRevision !== previous.layoutRevision,
      snapshot.maximizedPaneId !== previous.maximizedPaneId,
      snapshot.paneRearrangementSelection !==
        previous.paneRearrangementSelection,
      snapshot.selectedGroupColumnId !== previous.selectedGroupColumnId,
      snapshot.presentationMode !== previous.presentationMode,
      cameraRequestChanged,
      focusedPaneHostMissing,
    ].some(Boolean);
  }

  private shouldDeferOverviewCameraBoundary(
    snapshot: WorkspaceLayoutSnapshot,
    moving: boolean,
  ): boolean {
    const previous = this.lastBoundarySnapshot;
    return (
      !moving &&
      !this.lastBoundaryMoving &&
      snapshot.presentationMode === "overview" &&
      previous.presentationMode === "overview" &&
      (this.pendingOverviewCameraBoundary !== null ||
        snapshot.overviewPanX !== previous.overviewPanX ||
        snapshot.overviewPanY !== previous.overviewPanY ||
        snapshot.overviewFixedScale !== previous.overviewFixedScale ||
        snapshot.overviewZoom !== previous.overviewZoom)
    );
  }

  private deferOverviewCameraBoundary(snapshot: WorkspaceLayoutSnapshot): void {
    this.pendingOverviewCameraBoundary = snapshot;
    this.pendingOverviewCameraBoundaryFrameCount = 0;
  }

  private publishDeferredOverviewCameraBoundary(
    snapshot: WorkspaceLayoutSnapshot,
    moving: boolean,
  ): void {
    if (!this.pendingOverviewCameraBoundary) {
      return;
    }
    if (
      moving ||
      this.lastBoundaryMoving ||
      snapshot.presentationMode !== "overview"
    ) {
      this.clearPendingOverviewCameraBoundary();
      return;
    }
    this.pendingOverviewCameraBoundary = snapshot;
    this.pendingOverviewCameraBoundaryFrameCount += 1;
    if (this.pendingOverviewCameraBoundaryFrameCount < 2) {
      return;
    }
    this.clearPendingOverviewCameraBoundary();
    this.publishBoundary(snapshot, "request");
  }

  private clearPendingOverviewCameraBoundary(): void {
    this.pendingOverviewCameraBoundary = null;
    this.pendingOverviewCameraBoundaryFrameCount = 0;
  }

  private publishBoundary(
    snapshot: WorkspaceLayoutSnapshot,
    boundary: WorkspaceFrameBoundary,
  ): void {
    this.lastBoundarySnapshot = snapshot;
    this.lastBoundaryMoving = workspaceSnapshotIsMoving(snapshot);
    const frame =
      boundary === "settle" &&
      this.lastPresentationBoundaryFrame?.snapshot === snapshot
        ? this.lastPresentationBoundaryFrame
        : null;
    this.options.onBoundary(snapshot, boundary, frame);
  }

  private prefersReducedMotion(): boolean {
    return this.options.reducedMotionQuery?.matches ?? false;
  }
}

export function workspaceSnapshotIsMoving(
  snapshot: WorkspaceLayoutSnapshot,
): boolean {
  const overviewTarget = snapshot.presentationMode === "overview" ? 1 : 0;
  return (
    Math.abs(snapshot.scrollColumn - snapshot.targetScrollColumn) > 0.001 ||
    Math.abs(
      snapshot.horizontalAnchorOffset - snapshot.targetHorizontalAnchorOffset,
    ) > 0.001 ||
    !workspaceScrollRowIsSettled(
      snapshot.scrollRow,
      snapshot.targetScrollRow,
    ) ||
    Math.abs(
      snapshot.verticalAnchorOffset - snapshot.targetVerticalAnchorOffset,
    ) > 0.001 ||
    Math.abs(snapshot.overviewProgress - overviewTarget) > 0.001
  );
}
