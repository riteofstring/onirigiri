import { PaneDefaultsContext } from "../panes/pane-content-layout.js";
import { usePanePictures } from "../pictures/use-pane-pictures.js";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { WorkspaceLayoutSnapshot } from "../state/layout-store.js";
import {
  ReservedSplitCell,
  reservedSplitCellKey,
} from "../panes/onirigiri-reserved-split.js";
import {
  OnirigiriStylingProvider,
  type OnirigiriStylingOptions,
} from "../styles/onirigiri-styling.js";
import { onirigiriStylingContract } from "../styles/onirigiri-theme.js";
import { resolveOnirigiriWorkspaceSlots } from "./onirigiri-workspace-slots.js";
import { OnirigiriWorkspacePaneLayer } from "./onirigiri-workspace-pane-layer.js";
import { OnirigiriWorkspaceMinimap } from "./onirigiri-workspace-minimap.js";
import {
  compactPanePeekIsEnabled,
  matchingBoundaryFrame,
  paneRowHeights,
  selectedPaneGroupColumnId,
} from "../presentation/onirigiri-workspace-presentation-geometry.js";
import {
  PaneViewportLifecycle,
  retainedPaneShells,
} from "../panes/pane-viewport-lifecycle.js";
import type {
  OnirigiriWorkspaceHandle,
  OnirigiriWorkspaceProps,
} from "./onirigiri-workspace-types.js";
import { useOnirigiriRuntime } from "./onirigiri-workspace-runtime.js";
import { useOnirigiriPaneLink } from "./onirigiri-pane-link.js";
import { useOnirigiriWorkspacePresentation } from "../presentation/use-onirigiri-workspace-presentation.js";
import { useOnirigiriStageViewport } from "./use-onirigiri-stage-viewport.js";
import { resolveOnirigiriWorkspaceProps } from "./onirigiri-workspace-props.js";
import {
  focusOverviewPaneFromClick,
  focusPaneFromPointer,
} from "../input/pane-focus-interactions.js";
import {
  beginPaneResize,
  type PaneResizeStart,
} from "../input/pane-resize-interactions.js";
import { paneSizingTargets } from "../layout/pane-sizing.js";
import type {
  ColumnFocusEdge,
  FocusDirection,
  OpenPaneRequest,
  PaneId,
  PaneInsertionPlacement,
  PaneMoveDirection,
  PaneSizeTarget,
  PaneSizingMode,
  Rect,
} from "../types.js";
import { useWorkspaceWorldFrames } from "../presentation/use-workspace-world-frames.js";
import {
  focusDirections,
  WorkspaceControlsPlacement,
} from "../input/workspace-controls.js";
import {
  workspaceReservedCellRenderItems,
  WorkspaceRenderItemRenderer,
  WorkspaceWorldFrameRenderer,
} from "../presentation/workspace-render-items.js";
import { workspacePaneRearrangementSweep } from "../presentation/workspace-pane-rearrangement-sweep.js";
import { serializeWorkspaceLayout } from "./workspace-scene.js";
import { workspaceGridCursorAnnouncement } from "./workspace-grid-cursor.js";
import {
  matchOnirigiriShortcutAction,
  normalizeOnirigiriShortcutBindings,
} from "../input/workspace-shortcuts.js";
import {
  dispatchWorkspaceShortcut,
  handleWorkspaceEscapeShortcut,
  workspaceShortcutKeyDownHandler,
} from "../input/workspace-shortcut-react.js";
import {
  workspaceSnapshotIsMoving,
  type WorkspaceFrameMotionOptions,
  type WorkspaceFrameScheduler,
  type WorkspacePresentationBoundaryFrame,
} from "../presentation/workspace-frame-scheduler.js";
import {
  defaultCameraMotion,
  defaultFocusHighlightMotion,
  resolveCameraMotion,
  validMotionCurve,
} from "../presentation/motion-curve.js";
import {
  activateApplicationShortcutWorkspaceIfEnabled,
  eventTargetIsInsideAnotherWorkspace,
  isActiveApplicationShortcutWorkspace,
  registerApplicationShortcutWorkspace,
  shortcutEventIsIgnored,
  workspaceChromeFocusedPaneId,
  type OnirigiriShortcutKeyboardEvent,
} from "../input/workspace-shortcut-runtime.js";

const defaultViewport: Rect = { height: 1, width: 1, x: 0, y: 0 };

export const OnirigiriWorkspace = forwardRef<
  OnirigiriWorkspaceHandle,
  OnirigiriWorkspaceProps
>(function OnirigiriWorkspace(unresolvedProps, forwardedRef) {
  const {
    allowResizedPanesToOverflowViewport,
    ariaLabel,
    cameraModes,
    cameraMotion,
    chromeComponents,
    className,
    classNames,
    compactBreakpoint,
    compactPanePeek,
    cursorRunway,
    desktopControlsContainer,
    directionControlMode,
    focusAnchor,
    focusHighlight,
    gridAxes,
    initialLayout,
    initialPanes,
    minimapAdjustable,
    minimapPlacement,
    onLayoutChange,
    onMinimapPlacementChange,
    onPaneClose,
    onPaneRearrangementSelectionChange,
    onPresentationModeChange,
    overviewCardMaxWidthPx,
    overviewCardMinWidthPx,
    paneLimits,
    paneLink,
    paneDefaults,
    paneTypeDefaults,
    getPanePicture,
    panePresentation,
    getPanePresentation,
    renderPanePlaceholder,
    liveContent,
    onCaptureStatusChange,
    onPanePresentationChange,
    pictureBudgetBytes,
    pictureRasterBudgetBytes,
    pictureMinLongEdgePx,
    captureMissingOverviewPictures,
    renderPane,
    retainedAreaBudgetViewports,
    preloadMarginPanes,
    preloadAllPanePictures,
    shortcutScope,
    shortcuts,
    showControls,
    showMinimap,
    showOverviewControl,
    style,
    styles,
    tokens,
    workspaceId,
  } = resolveOnirigiriWorkspaceProps(unresolvedProps);
  const runtime = useOnirigiriRuntime({
    allowResizedPanesToOverflowViewport,
    cameraModes,
    cursorRunway,
    focusAnchor,
    gridAxes,
    initialLayout,
    initialPanes,
    overviewCardMaxWidthPx,
    overviewCardMinWidthPx,
    paneLimits,
    paneDefaults,
    paneTypeDefaults,
    workspaceId,
  });
  const defaultsConfiguration = useMemo(
    () => ({ paneDefaults, paneTypeDefaults }),
    [paneDefaults, paneTypeDefaults],
  );
  useLayoutEffect(() => {
    runtime.store.setPaneDefaults(defaultsConfiguration);
  }, [defaultsConfiguration, runtime]);
  useLayoutEffect(() => {
    runtime.store.setCursorRunway(cursorRunway);
  }, [cursorRunway, runtime]);
  useOnirigiriPaneLink(runtime.store, paneLink);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const pictures = usePanePictures(runtime, workspaceRef);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const worldGridRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const schedulerRef = useRef<WorkspaceFrameScheduler | null>(null);
  const boundaryFrameRef = useRef<WorkspacePresentationBoundaryFrame | null>(
    null,
  );
  const applicationShortcutToken = useRef(
    Symbol("onirigiri-application-shortcuts"),
  ).current;
  const closeHandlerRef = useRef(onPaneClose);
  closeHandlerRef.current = onPaneClose;
  const layoutChangeHandlerRef = useRef(onLayoutChange);
  layoutChangeHandlerRef.current = onLayoutChange;
  const presentationModeChangeHandlerRef = useRef(onPresentationModeChange);
  presentationModeChangeHandlerRef.current = onPresentationModeChange;
  const rearrangementSelectionHandlerRef = useRef(
    onPaneRearrangementSelectionChange,
  );
  rearrangementSelectionHandlerRef.current = onPaneRearrangementSelectionChange;
  const [viewport, setViewport] = useState<Rect>(defaultViewport);
  const [layoutSnapshot, setLayoutSnapshot] = useState<WorkspaceLayoutSnapshot>(
    () => runtime.store.getSnapshot(),
  );
  const [presentationMoving, setPresentationMoving] = useState(false);
  const observedPaneRearrangementRevisionRef = useRef(
    runtime.store.getSnapshot().paneRearrangementRevision,
  );
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const announceStatus = useCallback((announcement: string) => {
    setStatusAnnouncement((current) =>
      current === announcement ? `${announcement}\u200b` : announcement,
    );
  }, []);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  useEffect(
    () =>
      runtime.store.subscribe((snapshot) => {
        if (
          snapshot.paneRearrangementRevision !==
          observedPaneRearrangementRevisionRef.current
        ) {
          observedPaneRearrangementRevisionRef.current =
            snapshot.paneRearrangementRevision;
          setPresentationMoving(true);
        }
        observedPaneRearrangementRevisionRef.current =
          snapshot.paneRearrangementRevision;
        setLayoutSnapshot((current) =>
          current.paneRearrangementSelection ===
            snapshot.paneRearrangementSelection &&
          current.selectedGroupColumnId === snapshot.selectedGroupColumnId
            ? current
            : snapshot,
        );
      }),
    [runtime],
  );
  useEffect(() => {
    runtime.store.setCameraModes(cameraModes);
  }, [cameraModes, runtime]);
  const motion = workspaceFrameMotionOptions(cameraMotion, focusHighlight);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  useLayoutEffect(() => {
    runtime.store.setCameraMotion(motion.camera);
  }, [motion.camera, runtime]);
  const focusHighlightEnabled = focusHighlight !== false;
  const pendingChromeFocusPaneIdRef = useRef<PaneId | null>(null);
  const explicitCursorAnnouncementRef = useRef<string | null>(null);
  const paneViewportLifecycleRef = useRef<PaneViewportLifecycle | null>(null);
  paneViewportLifecycleRef.current ??= new PaneViewportLifecycle(
    retainedAreaBudgetViewports,
    (paneId) => pictures.get(paneId) !== null,
  );
  const renderItemRendererRef = useRef<WorkspaceRenderItemRenderer | null>(
    null,
  );
  renderItemRendererRef.current ??= new WorkspaceRenderItemRenderer();
  const renderItemRenderer = renderItemRendererRef.current;
  const worldFrameRendererRef = useRef<WorkspaceWorldFrameRenderer | null>(
    null,
  );
  worldFrameRendererRef.current ??= new WorkspaceWorldFrameRenderer();
  const worldFrameRenderer = worldFrameRendererRef.current;
  const normalizedShortcuts = useMemo(
    () => normalizeOnirigiriShortcutBindings(shortcuts),
    [shortcuts],
  );
  const styling = useMemo<OnirigiriStylingOptions>(
    () => ({ chromeComponents, classNames, styles }),
    [chromeComponents, classNames, styles],
  );
  const handleShortcutKeyDown = useCallback(
    (event: OnirigiriShortcutKeyboardEvent) => {
      if (shortcutEventIsIgnored(event)) {
        return;
      }
      if (event.key === "Escape") {
        handleWorkspaceEscapeShortcut(event, runtime.store, announceStatus);
        return;
      }
      const shortcutAction = matchOnirigiriShortcutAction(
        event,
        normalizedShortcuts,
      );
      if (!shortcutAction) {
        return;
      }
      const announcement = dispatchWorkspaceShortcut({
        event,
        pendingChromeFocusPaneId: pendingChromeFocusPaneIdRef,
        setLayoutSnapshot,
        setStatusAnnouncement: announceStatus,
        shortcutAction,
        store: runtime.store,
        viewport,
        workspace: workspaceRef.current,
      });
      if (announcement) {
        const cursor = runtime.store.getSnapshot().cursor;
        explicitCursorAnnouncementRef.current = `${String(cursor.column)}:${String(cursor.row)}:${String(cursor.split)}`;
      }
    },
    [announceStatus, normalizedShortcuts, runtime, viewport],
  );
  const shortcutKeyDownHandlerRef = useRef(handleShortcutKeyDown);
  shortcutKeyDownHandlerRef.current = handleShortcutKeyDown;

  const activateApplicationShortcuts = useCallback(
    () =>
      activateApplicationShortcutWorkspaceIfEnabled(
        shortcutScope,
        workspaceRef.current,
        applicationShortcutToken,
      ),
    [applicationShortcutToken, shortcutScope],
  );

  useEffect(() => {
    if (shortcutScope !== "application") {
      return;
    }
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }
    const ownerDocument = workspace.ownerDocument;
    const unregister = registerApplicationShortcutWorkspace(
      ownerDocument,
      applicationShortcutToken,
    );
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        isActiveApplicationShortcutWorkspace(
          ownerDocument,
          applicationShortcutToken,
        ) &&
        !eventTargetIsInsideAnotherWorkspace(event.target, workspace)
      ) {
        shortcutKeyDownHandlerRef.current(event);
      }
    };
    ownerDocument.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      ownerDocument.removeEventListener("keydown", handleDocumentKeyDown);
      unregister();
    };
  }, [applicationShortcutToken, shortcutScope]);

  useOnirigiriWorkspacePresentation({
    boundaryFrameRef,
    compactBreakpoint,
    cursorRef,
    focusHighlightEnabled,
    motionRef,
    runtime,
    pictures,
    schedulerRef,
    setLayoutSnapshot,
    setPresentationMoving,
    viewportRef,
    workspaceRef,
    worldGridRef,
    worldRef,
  });

  useOnirigiriStageViewport({
    compactBreakpoint,
    compactPanePeek,
    runtime,
    schedulerRef,
    setLayoutSnapshot,
    setViewport,
    stageRef,
    viewportRef,
  });

  useEffect(() => {
    runtime.store.setFocusAnchor(focusAnchor, viewport);
  }, [focusAnchor, runtime, viewport]);

  useEffect(() => {
    layoutChangeHandlerRef.current?.(
      serializeWorkspaceLayout(runtime.store.toScene(), layoutSnapshot.cursor),
      {
        kind: layoutSnapshot.layoutChangeKind,
        mutationId: layoutSnapshot.layoutMutationId,
        layoutRevision: layoutSnapshot.layoutRevision,
      },
    );
  }, [
    layoutSnapshot.cursor,
    layoutSnapshot.layoutChangeKind,
    layoutSnapshot.layoutMutationId,
    layoutSnapshot.layoutRevision,
    runtime,
  ]);

  useEffect(() => {
    const cursorAnnouncementKey = `${String(layoutSnapshot.cursor.column)}:${String(layoutSnapshot.cursor.row)}:${String(layoutSnapshot.cursor.split)}`;
    if (explicitCursorAnnouncementRef.current === cursorAnnouncementKey) {
      explicitCursorAnnouncementRef.current = null;
      return;
    }
    const pane = layoutSnapshot.focusedPaneId
      ? runtime.store.toScene().paneById.get(layoutSnapshot.focusedPaneId)
      : null;
    announceStatus(
      workspaceGridCursorAnnouncement(
        {
          column: layoutSnapshot.cursor.column,
          row: layoutSnapshot.cursor.row,
          split: layoutSnapshot.cursor.split,
        },
        pane?.title ?? null,
      ),
    );
  }, [
    announceStatus,
    layoutSnapshot.cursor.column,
    layoutSnapshot.cursor.row,
    layoutSnapshot.cursor.split,
    layoutSnapshot.focusedPaneId,
    runtime,
  ]);

  useEffect(() => {
    presentationModeChangeHandlerRef.current?.(layoutSnapshot.presentationMode);
  }, [layoutSnapshot.presentationMode]);

  useEffect(() => {
    rearrangementSelectionHandlerRef.current?.(
      layoutSnapshot.paneRearrangementSelection,
    );
  }, [layoutSnapshot.paneRearrangementSelection]);

  const closePane = useCallback(
    async (paneId: PaneId): Promise<boolean> => {
      const pane = runtime.store.toScene().paneById.get(paneId);
      if (!pane) {
        return false;
      }
      const accepted = (await closeHandlerRef.current?.(pane)) ?? true;
      if (!accepted) {
        return false;
      }
      const chromePaneId = workspaceChromeFocusedPaneId(workspaceRef.current);
      runtime.store.closePaneOrClearLastPane(paneId);
      if (chromePaneId) {
        pendingChromeFocusPaneIdRef.current = runtime.store.focusedPaneId();
      }
      return true;
    },
    [runtime],
  );

  const splitPane = useCallback(
    (paneId: PaneId, direction: "up" | "down" | "left" | "right") => {
      const chromePaneId = workspaceChromeFocusedPaneId(workspaceRef.current);
      const createdPaneId = runtime.store.splitPane(paneId, direction);
      if (chromePaneId) {
        pendingChromeFocusPaneIdRef.current = createdPaneId;
      }
      return createdPaneId;
    },
    [runtime],
  );

  const splitPaneToPlane = useCallback(
    (paneId: PaneId, direction: "up" | "down") => {
      const chromePaneId = workspaceChromeFocusedPaneId(workspaceRef.current);
      const createdPaneId = runtime.store.splitPaneToPlane(paneId, direction);
      if (chromePaneId) {
        pendingChromeFocusPaneIdRef.current = createdPaneId;
      }
      return createdPaneId;
    },
    [runtime],
  );

  const resizePanes = useCallback(
    (mode: PaneSizingMode) => {
      if (mode === "default") {
        runtime.store.resetWorkspaceSizing(viewport);
        return;
      }
      const snapshot = runtime.store.getSnapshot();
      const currentSizes: PaneSizeTarget[] = [];
      runtime.engine.renderFrame(
        {
          cursor: snapshot.cursor,
          focusedPaneId: snapshot.focusedPaneId,
          maximizedPaneId: null,
          movementPhase: "idle",
          presentationMode: "normal",
          renderAllColumns: true,
          scrollColumn: snapshot.scrollColumn,
          scrollRow: snapshot.scrollRow,
          verticalAnchorOffset: snapshot.verticalAnchorOffset,
          viewport,
        },
        (item) =>
          currentSizes.push({
            heightPx: item.height,
            paneId: item.paneId,
            widthPx: item.width,
          }),
      );
      runtime.store.resizePanes(
        paneSizingTargets({
          currentSizes,
          mode,
          scene: runtime.store.toScene(),
          viewport,
          workspace: workspaceRef.current,
        }),
        viewport,
        mode,
      );
    },
    [runtime, viewport],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      closePane,
      configurePane(paneId: PaneId, request: OpenPaneRequest) {
        return runtime.store.configurePane(paneId, request);
      },
      focusPane(paneId: PaneId) {
        return runtime.store.focusPane(paneId);
      },
      returnHome() {
        return runtime.store.returnHome(viewport);
      },
      focus(direction: FocusDirection) {
        return runtime.store.moveFocus(direction, viewport);
      },
      focusColumn(edge: ColumnFocusEdge) {
        return runtime.store.focusColumn(edge, viewport);
      },
      getLayout() {
        const snapshot = runtime.store.getSnapshot();
        return serializeWorkspaceLayout(
          runtime.store.toScene(),
          snapshot.cursor,
        );
      },
      getScene() {
        return runtime.store.toScene();
      },
      getSnapshot() {
        return runtime.store.getSnapshot();
      },
      openPane(request: OpenPaneRequest) {
        return runtime.store.openPane(request);
      },
      openPaneNear(
        paneId: PaneId,
        placement: PaneInsertionPlacement,
        request: OpenPaneRequest,
      ) {
        return runtime.store.openPaneNear(paneId, placement, request);
      },
      movePane(direction: PaneMoveDirection) {
        return runtime.store.moveFocusedPane(direction);
      },
      movePaneGroup(direction: PaneMoveDirection) {
        return runtime.store.moveSelectedPaneGroup(direction);
      },
      renamePane(paneId: PaneId, title: string) {
        return runtime.store.renamePane(paneId, title);
      },
      insertPaneAsSplit(direction: "left" | "right") {
        return runtime.store.insertFocusedPaneAsSplit(direction);
      },
      createReservedBlankSplit(direction: "up" | "down") {
        return runtime.store.createFocusedReservedBlankSplit(direction);
      },
      removeReservedBlankSplit(direction: "up" | "down") {
        return runtime.store.removeFocusedReservedBlankSplit(direction);
      },
      getCaptureStatus: pictures.getStatus,
      getPanePresentationState: pictures.getPresentation,
      refreshPanePictures: pictures.refresh,
      restoreLayout(layout) {
        runtime.store.restoreLayout(layout);
      },
      selectPaneGroup() {
        return runtime.store.selectFocusedPaneGroup();
      },
      clearPaneRearrangementGroup() {
        return runtime.store.clearPaneRearrangementGroup();
      },
      resizePanes,
      setFocusAnchor(anchor) {
        runtime.store.setFocusAnchor(anchor, viewport);
      },
      splitPane,
      splitPaneToPlane,
      toggleOverview() {
        runtime.store.toggleOverviewMode();
      },
    }),
    [
      closePane,
      pictures,
      resizePanes,
      runtime,
      splitPane,
      splitPaneToPlane,
      viewport,
    ],
  );

  const scene = useMemo(() => {
    void layoutSnapshot.layoutRevision;
    return runtime.store.toScene();
  }, [layoutSnapshot.layoutRevision, runtime]);
  const paneById = scene.paneById;
  const moving =
    workspaceSnapshotIsMoving(layoutSnapshot) ||
    presentationMoving ||
    runtime.presentation.hasActivePaneRearrangement() ||
    runtime.worldPresentation.hasActiveMotion();
  const compactLayout = viewport.width <= compactBreakpoint;
  const compactPanePeekEnabled = compactPanePeekIsEnabled(
    compactLayout,
    compactPanePeek,
  );
  const boundaryFrame = matchingBoundaryFrame(
    boundaryFrameRef.current,
    layoutSnapshot,
  );
  useLayoutEffect(() => {
    if (boundaryFrameRef.current === boundaryFrame) {
      boundaryFrameRef.current = null;
    }
  }, [boundaryFrame]);
  const renderItems = useMemo(() => {
    if (boundaryFrame) {
      return boundaryFrame.items;
    }
    const input = {
      compactLayout,
      engine: runtime.engine,
      moving,
      snapshot: layoutSnapshot,
      sweepGrid: runtime.worldPresentation.activeMotionGrid(),
      viewport,
    };
    const source = moving
      ? runtime.store.paneRearrangementSourceFor(
          layoutSnapshot.paneRearrangementRevision,
        )
      : null;
    return workspacePaneRearrangementSweep(
      input,
      renderItemRenderer.render(input),
      source,
    ).items;
  }, [
    boundaryFrame,
    compactLayout,
    layoutSnapshot,
    moving,
    renderItemRenderer,
    runtime,
    viewport,
  ]);
  const { mountContentDuringMotion, targetWorldFrame } =
    useWorkspaceWorldFrames({
      compactLayout,
      engine: runtime.engine,
      layoutSnapshot,
      moving,
      viewport,
      worldFrameRenderer,
    });
  const livePresentation =
    panePresentation !== undefined || getPanePresentation !== undefined;
  const presentationKey = JSON.stringify(panePresentation);
  const stablePanePresentation = useMemo(
    () =>
      presentationKey === undefined
        ? undefined
        : (JSON.parse(presentationKey) as typeof panePresentation),
    [presentationKey],
  );
  const mountedRenderItems = useMemo(() => {
    const lifecycle = paneViewportLifecycleRef.current;
    if (!lifecycle) {
      return [];
    }
    lifecycle.setRetainedAreaBudgetViewports(retainedAreaBudgetViewports);
    const retainedItems = lifecycle.resolve({
      items: renderItems,
      mountContentDuringMotion,
      livePresentation,
      liveContent,
      moving,
      panes: scene.panes,
      snapshot: layoutSnapshot,
      targetWorldFrame,
      viewport,
    });
    return retainedPaneShells(renderItems, retainedItems);
  }, [
    layoutSnapshot,
    mountContentDuringMotion,
    liveContent,
    livePresentation,
    moving,
    renderItems,
    retainedAreaBudgetViewports,
    scene.panes,
    targetWorldFrame,
    viewport,
  ]);
  useLayoutEffect(() => {
    pictures.configure({
      panes: paneById,
      items: mountedRenderItems,
      resolver: getPanePicture,
      presentation: stablePanePresentation,
      getPresentation: getPanePresentation,
      liveContent,
      budgetBytes: pictureBudgetBytes,
      rasterBudgetBytes: pictureRasterBudgetBytes,
      minLongEdgePx: pictureMinLongEdgePx,
      captureMissingOverviewPictures,
      onStatus: onCaptureStatusChange,
      onPresentationChange: onPanePresentationChange,
      preloadMarginPanes,
      preloadAllPanePictures,
    });
  }, [
    pictures,
    paneById,
    mountedRenderItems,
    getPanePicture,
    stablePanePresentation,
    getPanePresentation,
    liveContent,
    pictureBudgetBytes,
    pictureRasterBudgetBytes,
    pictureMinLongEdgePx,
    captureMissingOverviewPictures,
    onCaptureStatusChange,
    onPanePresentationChange,
    preloadMarginPanes,
    preloadAllPanePictures,
    viewport,
  ]);

  const directionMoveAvailableByDirection = useMemo(() => {
    void layoutSnapshot.revision;
    const scene =
      cursorRunway === undefined ? undefined : runtime.store.toScene();
    return new Map(
      focusDirections.map((direction) => [
        direction,
        directionControlMode === "focus"
          ? runtime.store.canMoveFocus(direction, scene)
          : layoutSnapshot.focusedPaneId !== null &&
            runtime.store.canMoveFocus(direction, scene),
      ]),
    );
  }, [
    cursorRunway,
    directionControlMode,
    layoutSnapshot.focusedPaneId,
    layoutSnapshot.revision,
    runtime,
  ]);
  const moveFromDirectionControl = useCallback(
    (direction: FocusDirection) => {
      if (directionControlMode === "focus") {
        runtime.store.moveFocus(direction, viewport);
        return;
      }
      if (directionControlMode === "move-pane") {
        runtime.store.moveFocusedPane(direction);
        return;
      }
      runtime.store.selectFocusedPaneGroup();
      runtime.store.moveSelectedPaneGroup(direction);
    },
    [directionControlMode, runtime, viewport],
  );
  const renderItemByPaneId = useMemo(
    () => new Map(renderItems.map((item) => [item.paneId, item])),
    [renderItems],
  );
  const reservedCellItems = useMemo(
    () =>
      boundaryFrame?.reservedCells ??
      workspaceReservedCellRenderItems({
        compactLayout,
        engine: runtime.engine,
        moving,
        snapshot: layoutSnapshot,
        viewport,
      }),
    [boundaryFrame, compactLayout, layoutSnapshot, moving, runtime, viewport],
  );
  const columnById = useMemo(
    () => new Map(scene.columns.map((column) => [column.columnId, column])),
    [scene.columns],
  );
  const rowHeightByPaneId = useMemo(() => {
    return paneRowHeights(
      mountedRenderItems,
      paneById,
      columnById,
      renderItemByPaneId,
      scene.rowGap,
    );
  }, [
    columnById,
    mountedRenderItems,
    paneById,
    renderItemByPaneId,
    scene.rowGap,
  ]);
  const adjacentPaneIdByPaneId = useMemo(() => {
    const adjacentPaneIds = new Map<PaneId, PaneId>();
    for (const column of scene.columns) {
      for (let index = 0; index < column.cells.length - 1; index += 1) {
        const paneId = column.cells[index]?.paneId;
        const adjacentPaneId = column.cells[index + 1]?.paneId;
        if (paneId && adjacentPaneId) {
          adjacentPaneIds.set(paneId, adjacentPaneId);
        }
      }
    }
    return adjacentPaneIds;
  }, [scene.columns]);
  const abovePaneIdByPaneId = useMemo(
    () =>
      new Map(
        [...adjacentPaneIdByPaneId].map(([paneId, belowPaneId]) => [
          belowPaneId,
          paneId,
        ]),
      ),
    [adjacentPaneIdByPaneId],
  );

  useLayoutEffect(() => {
    const pendingPaneId = pendingChromeFocusPaneIdRef.current;
    const workspace = workspaceRef.current;
    if (!workspace || pendingPaneId !== layoutSnapshot.focusedPaneId) {
      return;
    }
    const pane = [
      ...workspace.querySelectorAll<HTMLElement>("[data-onirigiri-pane-id]"),
    ].find((candidate) => candidate.dataset.onirigiriPaneId === pendingPaneId);
    pane?.focus({ preventScroll: true });
    pendingChromeFocusPaneIdRef.current = null;
  }, [layoutSnapshot.focusedPaneId, layoutSnapshot.layoutRevision]);

  const resizePresentationRef = useRef({ renderItems, scene });
  resizePresentationRef.current = { renderItems, scene };
  const beginResize = useCallback<PaneResizeStart>(
    (event, item, edge, adjacentItem) => {
      const presentation = resizePresentationRef.current;
      beginPaneResize({
        adjacentItem,
        edge,
        event,
        item,
        renderItems: presentation.renderItems,
        scene: presentation.scene,
        store: runtime.store,
      });
    },
    [runtime],
  );

  const { cursorSlot, stageSlot, statusSlot, workspaceSlot } =
    resolveOnirigiriWorkspaceSlots(styling);
  const worldSurface = (
    <div
      className="onirigiri-workspace__world"
      data-onirigiri-world-surface="true"
      ref={worldRef}
    >
      <div
        aria-hidden="true"
        className="onirigiri-workspace__world-grid"
        data-onirigiri-world-grid="true"
        ref={worldGridRef}
      />
      {reservedCellItems.map((item) => (
        <ReservedSplitCell item={item} key={reservedSplitCellKey(item)} />
      ))}
      <OnirigiriWorkspacePaneLayer
        abovePaneIdByPaneId={abovePaneIdByPaneId}
        adjacentPaneIdByPaneId={adjacentPaneIdByPaneId}
        beginResize={beginResize}
        closePane={closePane}
        compactLayout={compactLayout}
        pictures={pictures}
        mountedRenderItems={mountedRenderItems}
        paneById={paneById}
        presentation={runtime.presentation}
        renderItemByPaneId={renderItemByPaneId}
        renderPane={renderPane}
        renderPanePlaceholder={renderPanePlaceholder}
        rowHeightByPaneId={rowHeightByPaneId}
        selectedGroupColumnId={selectedPaneGroupColumnId(layoutSnapshot)}
        showControls={showControls}
        store={runtime.store}
      />
      <WorkspaceFocusHighlight
        cursorRef={cursorRef}
        enabled={focusHighlightEnabled}
        slot={cursorSlot}
      />
    </div>
  );

  return (
    <PaneDefaultsContext.Provider value={defaultsConfiguration}>
      <OnirigiriStylingProvider value={styling}>
        <div
          aria-label={ariaLabel}
          className={[workspaceSlot.className, className]
            .filter(Boolean)
            .join(" ")}
          data-compact-layout={String(compactLayout)}
          data-compact-pane-peek={String(compactPanePeekEnabled)}
          data-focus-anchor={layoutSnapshot.focusAnchor}
          data-pane-rearrangement-selection={
            layoutSnapshot.paneRearrangementSelection
          }
          data-presentation-mode={layoutSnapshot.presentationMode}
          data-shortcut-scope={shortcutScope}
          data-onirigiri-slot="workspace"
          data-onirigiri-styling-version={onirigiriStylingContract.version}
          data-onirigiri-workspace-id={workspaceId}
          onFocusCapture={activateApplicationShortcuts}
          onKeyDown={workspaceShortcutKeyDownHandler(
            shortcutScope,
            handleShortcutKeyDown,
          )}
          onPointerDownCapture={activateApplicationShortcuts}
          ref={workspaceRef}
          role="region"
          style={{ ...workspaceSlot.style, ...tokens, ...style }}
          tabIndex={0}
        >
          <span
            aria-atomic="true"
            aria-live="polite"
            className={statusSlot.className}
            data-onirigiri-slot="status"
            role="status"
            style={statusSlot.style}
          >
            {statusAnnouncement}
          </span>
          <WorkspaceControlsPlacement
            compactLayout={compactLayout}
            desktopControlsContainer={desktopControlsContainer}
            directionControlMode={directionControlMode}
            directionMoveAvailableByDirection={
              directionMoveAvailableByDirection
            }
            moveDirection={moveFromDirectionControl}
            presentationMode={layoutSnapshot.presentationMode}
            shortcuts={normalizedShortcuts}
            showDirections={showControls}
            showOverview={showOverviewControl}
            toggleOverview={() => runtime.store.toggleOverviewMode()}
            tokens={tokens}
            workspaceId={workspaceId}
          />
          <div
            className={stageSlot.className}
            data-onirigiri-slot="stage"
            onClick={(event) =>
              focusOverviewPaneFromClick({
                eventTarget: event.target,
                presentationMode: layoutSnapshot.presentationMode,
                store: runtime.store,
                viewport,
                workspace: workspaceRef.current,
              })
            }
            onPointerDownCapture={(event) =>
              focusPaneFromPointer({
                button: event.button,
                eventTarget: event.target,
                focusedPaneId: layoutSnapshot.focusedPaneId,
                moving,
                presentationMode: layoutSnapshot.presentationMode,
                store: runtime.store,
                viewport,
                workspace: workspaceRef.current,
              })
            }
            ref={stageRef}
            role="presentation"
            style={stageSlot.style}
          >
            {worldSurface}
            <OnirigiriWorkspaceMinimap
              adjustable={minimapAdjustable}
              enabled={showMinimap}
              onPlacementChange={onMinimapPlacementChange}
              placement={minimapPlacement}
              presentation={runtime.minimapPresentation}
              stageRef={stageRef}
              store={runtime.store}
              viewportRef={viewportRef}
            />
          </div>
        </div>
      </OnirigiriStylingProvider>
    </PaneDefaultsContext.Provider>
  );
});

OnirigiriWorkspace.displayName = "OnirigiriWorkspace";

function workspaceFrameMotionOptions(
  cameraMotion: OnirigiriWorkspaceProps["cameraMotion"],
  focusHighlight: OnirigiriWorkspaceProps["focusHighlight"],
): WorkspaceFrameMotionOptions {
  const camera = resolveCameraMotion(cameraMotion);
  const requested =
    typeof focusHighlight === "object" ? focusHighlight.motion : undefined;
  return {
    camera,
    highlight:
      requested === undefined || requested === "camera"
        ? defaultFocusHighlightMotion
        : validMotionCurve(requested, defaultCameraMotion.overview),
  };
}

function WorkspaceFocusHighlight({
  cursorRef,
  enabled,
  slot,
}: {
  cursorRef: { current: HTMLDivElement | null };
  enabled: boolean;
  slot: { className: string; style: CSSProperties | undefined };
}) {
  if (!enabled) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      className={slot.className}
      data-onirigiri-grid-cursor="true"
      data-onirigiri-slot="grid-cursor"
      ref={cursorRef}
      style={slot.style}
    />
  );
}
