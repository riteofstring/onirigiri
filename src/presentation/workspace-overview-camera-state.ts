import type { WorkspaceLayoutSnapshot } from "../state/layout-store.js";
import type { WorkspaceCameraMode } from "../types.js";
import { workspaceGridCursorsEqual } from "../workspace/workspace-grid-cursor.js";

export function overviewCameraCanRetarget(
  previous: WorkspaceLayoutSnapshot,
  next: WorkspaceLayoutSnapshot,
  previousMode: WorkspaceCameraMode,
  nextMode: WorkspaceCameraMode,
  stationaryCursorRetargetAllowed: boolean,
): boolean {
  if (sameSettledOverviewScene(previous, next)) {
    return (
      stationaryCursorRetargetAllowed &&
      !sameSnapshotFields(previous, next, overviewCameraKeys)
    );
  }
  if (!stableOverviewCursorChange(previous, next)) {
    return false;
  }
  const keys = [previousMode, nextMode].every((mode) => mode === "follow")
    ? followingOverviewCameraKeys
    : overviewCameraKeys;
  return sameSnapshotFields(previous, next, keys);
}

function sameSettledOverviewScene(
  previous: WorkspaceLayoutSnapshot,
  next: WorkspaceLayoutSnapshot,
): boolean {
  return (
    overviewIsSettled(previous) &&
    overviewIsSettled(next) &&
    previous.layoutRevision === next.layoutRevision &&
    previous.paneRearrangementRevision === next.paneRearrangementRevision &&
    previous.maximizedPaneId === next.maximizedPaneId &&
    workspaceGridCursorsEqual(previous.cursor, next.cursor)
  );
}

function stableOverviewCursorChange(
  previous: WorkspaceLayoutSnapshot,
  next: WorkspaceLayoutSnapshot,
): boolean {
  const layoutCanRetarget =
    previous.layoutRevision === next.layoutRevision ||
    previous.paneRearrangementRevision !== next.paneRearrangementRevision;
  return [
    overviewIsSettled(previous),
    overviewIsSettled(next),
    !workspaceGridCursorsEqual(previous.cursor, next.cursor),
    layoutCanRetarget,
    previous.maximizedPaneId === next.maximizedPaneId,
  ].every(Boolean);
}

function overviewIsSettled(snapshot: WorkspaceLayoutSnapshot): boolean {
  return (
    snapshot.presentationMode === "overview" &&
    Math.abs(snapshot.overviewProgress - 1) <= 0.001
  );
}

export function sameOverviewCameraFrame(
  previous: WorkspaceLayoutSnapshot,
  next: WorkspaceLayoutSnapshot,
): boolean {
  return [
    previous.presentationMode === next.presentationMode,
    workspaceGridCursorsEqual(previous.cursor, next.cursor),
    previous.layoutRevision === next.layoutRevision,
    previous.maximizedPaneId === next.maximizedPaneId,
    sameSnapshotFields(previous, next, overviewCameraKeys),
  ].every(Boolean);
}

const followingOverviewCameraKeys = [
  "overviewPanX",
  "overviewPanY",
  "overviewFixedScale",
] as const satisfies readonly (keyof WorkspaceLayoutSnapshot)[];

const overviewCameraKeys = [
  "overviewFollowOffsetX",
  "overviewFollowOffsetY",
  "overviewPanX",
  "overviewPanY",
  "overviewFixedScale",
  "overviewZoom",
] as const satisfies readonly (keyof WorkspaceLayoutSnapshot)[];

function sameSnapshotFields(
  previous: WorkspaceLayoutSnapshot,
  next: WorkspaceLayoutSnapshot,
  keys: readonly (keyof WorkspaceLayoutSnapshot)[],
): boolean {
  return keys.every((key) => previous[key] === next[key]);
}
