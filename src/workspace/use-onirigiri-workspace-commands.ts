import { useCallback, useImperativeHandle } from "react";

import { workspaceChromeFocusedPaneId } from "../input/workspace-shortcut-runtime.js";
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
import { useOnirigiriRuntime } from "./onirigiri-workspace-runtime.js";
import type {
  OnirigiriFocusPaneOptions,
  OnirigiriWorkspaceHandle,
  OnirigiriWorkspaceProps,
} from "./onirigiri-workspace-types.js";
import { serializeWorkspaceLayout } from "./workspace-scene.js";

import type { ForwardedRef } from "react";
import type { PanePictures } from "../pictures/pane-pictures.js";

export function useOnirigiriWorkspaceCommands({
  closeHandlerRef,
  forwardedRef,
  pendingChromeFocusPaneIdRef,
  pictures,
  runtime,
  viewport,
  workspaceRef,
}: {
  closeHandlerRef: { current: OnirigiriWorkspaceProps["onPaneClose"] };
  forwardedRef: ForwardedRef<OnirigiriWorkspaceHandle>;
  pendingChromeFocusPaneIdRef: { current: PaneId | null };
  pictures: PanePictures;
  runtime: ReturnType<typeof useOnirigiriRuntime>;
  viewport: Rect;
  workspaceRef: { current: HTMLDivElement | null };
}) {
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
    [closeHandlerRef, pendingChromeFocusPaneIdRef, runtime, workspaceRef],
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
    [pendingChromeFocusPaneIdRef, runtime, workspaceRef],
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
    [pendingChromeFocusPaneIdRef, runtime, workspaceRef],
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
    [runtime, viewport, workspaceRef],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      closePane,
      configurePane(paneId: PaneId, request: OpenPaneRequest) {
        return runtime.store.configurePane(paneId, request);
      },
      focusPane(paneId: PaneId, options?: OnirigiriFocusPaneOptions) {
        return options?.exitOverview &&
          runtime.store.getSnapshot().presentationMode === "overview"
          ? runtime.store.focusOverviewPane(paneId, viewport)
          : runtime.store.focusPane(paneId);
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
      restoreLayout(layout, options) {
        runtime.store.restoreLayout(layout, options);
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
      togglePaneMaximized(paneId: PaneId) {
        runtime.store.togglePaneMaximized(paneId);
      },
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

  return closePane;
}
