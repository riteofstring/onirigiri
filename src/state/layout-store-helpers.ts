import type { WorkspaceLikeLayoutEngine } from "../layout/layout-engine.js";
import {
  minimumPaneHeightPx,
  distributePaneHeights,
} from "../panes/pane-resize-geometry.js";
import type { WorkspacePaneLimitState } from "./layout-store-types.js";
import type {
  OpenPaneRequest,
  PaneId,
  PaneLimitPolicy,
  WorkspaceColumn,
  WorkspaceScene,
} from "../types.js";

export function clampPan(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

export function clampRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function emptyFramePaneRequest(): OpenPaneRequest {
  return {
    subtitle: "choose a pane type",
    surfaceKind: "empty-frame",
    title: "New frame",
    tone: "slate",
  };
}

function resizeColumnStack(
  engine: WorkspaceLikeLayoutEngine,
  scene: WorkspaceScene,
  column: WorkspaceColumn,
  targetOuterHeight: number | null,
): boolean {
  if (column.cells.length === 0) {
    return false;
  }
  if (targetOuterHeight === null) {
    return engine.resizeColumnRows(
      column.columnId,
      column.cells.map(() => null),
    );
  }
  const stackHeight =
    targetOuterHeight - scene.rowGap * Math.max(0, column.cells.length - 1);
  const rowHeights = distributePaneHeights(
    stackHeight,
    column.cells.map((cell) => cell.weight),
  );
  return engine.resizeColumnRows(column.columnId, rowHeights);
}

export function resizePaneRowAcrossPlane(
  engine: WorkspaceLikeLayoutEngine,
  scene: WorkspaceScene,
  paneId: PaneId,
  heightPx: number | null,
): boolean {
  const source = engine.paneLocation(paneId);
  if (!source) {
    return false;
  }
  const planeColumns = scene.columns.filter(
    (column) => column.planeIndex === source.planeIndex,
  );
  const targetOuterHeight =
    heightPx === null
      ? null
      : Math.max(
          heightPx,
          ...planeColumns.map(
            (column) =>
              column.cells.length * minimumPaneHeightPx +
              Math.max(0, column.cells.length - 1) * scene.rowGap,
          ),
        );
  return planeColumns.reduce(
    (resized, column) =>
      resizeColumnStack(engine, scene, column, targetOuterHeight) || resized,
    false,
  );
}

export function workspacePaneLimitState(
  scene: WorkspaceScene,
  paneLimits: PaneLimitPolicy | undefined,
  request: { surfaceKind?: string },
): WorkspacePaneLimitState {
  const surfaceKind = request.surfaceKind ?? null;
  if (!surfaceKind) {
    return { allowed: true, count: 0, limit: null, surfaceKind };
  }
  const count = scene.panes.filter(
    (pane) => pane.surfaceKind === surfaceKind,
  ).length;
  const limit = paneLimits?.[surfaceKind] ?? null;
  return {
    allowed: limit === null || count < limit,
    count,
    limit,
    surfaceKind,
  };
}
