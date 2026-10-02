import { createStore } from "zustand/vanilla";

import type { PaneRearrangementController } from "./layout-store-rearrangement.js";
import type {
  WorkspaceLayoutSnapshot,
  WorkspaceLayoutStoreOptions,
} from "./layout-store-types.js";
import type { WorkspaceOverviewCamera } from "../layout/overview-camera.js";
import { defaultWorkspaceCameraModes } from "../types.js";
import type {
  WorkspaceScene,
  WorkspaceGridCursor,
  WorkspaceCameraModes,
} from "../types.js";
import {
  normalizeWorkspaceGridCursor,
  paneIdAtWorkspaceGridCursor,
} from "../workspace/workspace-grid-cursor.js";

export function createWorkspaceState(
  scene: WorkspaceScene,
  initialCursor: WorkspaceGridCursor,
  options: WorkspaceLayoutStoreOptions,
  overviewCamera: WorkspaceOverviewCamera,
  paneRearrangement: PaneRearrangementController,
) {
  const initial: WorkspaceLayoutSnapshot = {
    cursor: normalizeWorkspaceGridCursor(scene, initialCursor),
    focusAnchor: options.initialFocusAnchor ?? "center",
    focusedPaneId: paneIdAtWorkspaceGridCursor(
      scene,
      normalizeWorkspaceGridCursor(scene, initialCursor),
    ),
    horizontalAnchorOffset: 0,
    layoutChangeKind: "initial",
    layoutMutationId: 0,
    layoutRevision: 0,
    maximizedPaneId: null,
    overviewPanX: overviewCamera.overviewPanX,
    overviewPanY: overviewCamera.overviewPanY,
    overviewFollowOffsetX: overviewCamera.overviewFollowOffsetX,
    overviewFollowOffsetY: overviewCamera.overviewFollowOffsetY,
    overviewFixedScale: overviewCamera.overviewFixedScale,
    overviewProgress: overviewCamera.overviewProgress,
    overviewZoom: overviewCamera.overviewZoom,
    paneRearrangementRevision: 0,
    ...paneRearrangement.snapshot(),
    presentationMode: overviewCamera.mode,
    revision: 0,
    scrollColumn: 0,
    scrollRow: 0,
    targetHorizontalAnchorOffset: 0,
    targetScrollColumn: 0,
    targetScrollRow: 0,
    targetVerticalAnchorOffset: 0,
    verticalAnchorOffset: 0,
  };
  return {
    current: createStore<WorkspaceLayoutSnapshot>(() => initial),
    commands: createStore<WorkspaceLayoutSnapshot>(() => initial),
  };
}

export function deriveWorkspaceState(
  state: WorkspaceLayoutSnapshot,
  scene: WorkspaceScene,
  overview: WorkspaceOverviewCamera,
  rearrangement: PaneRearrangementController,
): WorkspaceLayoutSnapshot {
  return {
    ...state,
    focusedPaneId: paneIdAtWorkspaceGridCursor(scene, state.cursor),
    overviewPanX: overview.overviewPanX,
    overviewPanY: overview.overviewPanY,
    overviewFollowOffsetX: overview.overviewFollowOffsetX,
    overviewFollowOffsetY: overview.overviewFollowOffsetY,
    overviewFixedScale: overview.overviewFixedScale,
    overviewProgress: overview.overviewProgress,
    overviewZoom: overview.overviewZoom,
    ...rearrangement.snapshot(),
    presentationMode: overview.mode,
  };
}

export function nextWorkspaceRevision(
  snapshot: WorkspaceLayoutSnapshot,
  layoutChanged: boolean,
  kind: WorkspaceLayoutSnapshot["layoutChangeKind"],
  activeMutationId: number | null,
): WorkspaceLayoutSnapshot {
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    ...(layoutChanged
      ? {
          layoutMutationId:
            activeMutationId === null
              ? snapshot.layoutMutationId + 1
              : snapshot.layoutMutationId,
          layoutChangeKind: kind,
          layoutRevision: snapshot.layoutRevision + 1,
        }
      : {}),
  };
}

export function copyWorkspaceCameraModes(
  modes: WorkspaceCameraModes | undefined,
): WorkspaceCameraModes {
  return {
    normal: modes?.normal ?? defaultWorkspaceCameraModes.normal,
    overview: modes?.overview ?? defaultWorkspaceCameraModes.overview,
  };
}
