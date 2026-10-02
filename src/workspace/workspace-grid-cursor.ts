import { columnSlotIndex } from "../layout/column-slots";
import type {
  FocusDirection,
  PaneId,
  WorkspaceGridCursor,
  WorkspaceScene,
} from "../types";

const horizontalDirections = new Set<FocusDirection>(["left", "right"]);

export interface WorkspaceCursorRunwayBounds {
  maxColumn: number;
  maxRow: number;
  minColumn: number;
  minRow: number;
}

export const layoutOriginCursor: Readonly<WorkspaceGridCursor> = {
  column: 0,
  row: 0,
  split: 0,
};

export function workspaceGridCursorsEqual(
  left: WorkspaceGridCursor,
  right: WorkspaceGridCursor,
): boolean {
  return (
    left.column === right.column &&
    left.row === right.row &&
    left.split === right.split
  );
}

export function assertWorkspaceGridCursor(cursor: WorkspaceGridCursor): void {
  if (
    !isRecord(cursor) ||
    !isSafeInteger(cursor.column) ||
    !isSafeInteger(cursor.row) ||
    !isNonNegativeSafeInteger(cursor.split)
  ) {
    throw new Error("Onirigiri layout has an invalid workspace grid cursor");
  }
}

export function workspaceColumnAtGridCursor(
  scene: Pick<WorkspaceScene, "columns">,
  cursor: WorkspaceGridCursor,
) {
  return (
    scene.columns.find(
      (column) =>
        column.planeIndex === cursor.row &&
        columnSlotIndex(column) === cursor.column,
    ) ?? null
  );
}

export function paneIdAtWorkspaceGridCursor(
  scene: WorkspaceScene,
  cursor: WorkspaceGridCursor,
): PaneId | null {
  return (
    workspaceColumnAtGridCursor(scene, cursor)?.cells[cursor.split]?.paneId ??
    null
  );
}

export function workspaceGridCursorForPane(
  scene: WorkspaceScene,
  paneId: PaneId,
): WorkspaceGridCursor | null {
  for (const column of scene.columns) {
    const split = column.cells.findIndex((cell) => cell.paneId === paneId);
    if (split >= 0) {
      return {
        column: columnSlotIndex(column),
        row: column.planeIndex,
        split,
      };
    }
  }
  return null;
}

export function normalizeWorkspaceGridCursor(
  scene: Pick<WorkspaceScene, "columns">,
  cursor: WorkspaceGridCursor,
): WorkspaceGridCursor {
  assertWorkspaceGridCursor(cursor);
  const column = workspaceColumnAtGridCursor(scene, cursor);
  if (!column || column.cells.length === 0) {
    return { column: cursor.column, row: cursor.row, split: 0 };
  }
  return {
    column: cursor.column,
    row: cursor.row,
    split: Math.min(cursor.split, column.cells.length - 1),
  };
}

export function nextWorkspaceGridCursor({
  cursor,
  direction,
  scene,
}: {
  cursor: WorkspaceGridCursor;
  direction: FocusDirection;
  scene: WorkspaceScene;
}): WorkspaceGridCursor | null {
  const current = normalizeWorkspaceGridCursor(scene, cursor);
  if (horizontalDirections.has(direction)) {
    return nextHorizontalGridCursor(current, direction, scene);
  }
  return nextVerticalGridCursor(current, direction, scene);
}

export function resolveWorkspaceCursorRunway(
  cursorRunway: number | undefined,
): number | null {
  if (cursorRunway === undefined) {
    return null;
  }
  if (!isNonNegativeSafeInteger(cursorRunway)) {
    throw new Error(
      "Onirigiri cursorRunway must be a non-negative safe integer",
    );
  }
  return cursorRunway;
}

export function workspacePaneCursorRunwayBounds(
  scene: WorkspaceScene,
): WorkspaceCursorRunwayBounds | null {
  let maxColumn = Number.MIN_SAFE_INTEGER;
  let maxRow = Number.MIN_SAFE_INTEGER;
  let minColumn = Number.MAX_SAFE_INTEGER;
  let minRow = Number.MAX_SAFE_INTEGER;
  let hasPane = false;
  for (const column of scene.columns) {
    if (!column.cells.some((cell) => cell.paneId !== null)) {
      continue;
    }
    const slotIndex = columnSlotIndex(column);
    hasPane = true;
    maxColumn = Math.max(maxColumn, slotIndex);
    maxRow = Math.max(maxRow, column.planeIndex);
    minColumn = Math.min(minColumn, slotIndex);
    minRow = Math.min(minRow, column.planeIndex);
  }
  return hasPane ? { maxColumn, maxRow, minColumn, minRow } : null;
}

export function workspaceCursorMoveIsWithinRunway({
  bounds,
  current,
  next,
  runway,
}: {
  bounds: WorkspaceCursorRunwayBounds | null;
  current: WorkspaceGridCursor;
  next: WorkspaceGridCursor;
  runway: number | null;
}): boolean {
  if (runway === null || bounds === null) {
    return true;
  }
  const expanded = {
    maxColumn: Math.min(Number.MAX_SAFE_INTEGER, bounds.maxColumn + runway),
    maxRow: Math.min(Number.MAX_SAFE_INTEGER, bounds.maxRow + runway),
    minColumn: Math.max(Number.MIN_SAFE_INTEGER, bounds.minColumn - runway),
    minRow: Math.max(Number.MIN_SAFE_INTEGER, bounds.minRow - runway),
  };
  if (cursorIsWithinBounds(next, expanded)) {
    return true;
  }
  if (current.column === next.column && current.row === next.row) {
    return true;
  }
  if (cursorIsWithinBounds(current, expanded)) {
    return false;
  }
  return cursorMovesTowardBounds(current, next, expanded);
}

function nextHorizontalGridCursor(
  current: WorkspaceGridCursor,
  direction: FocusDirection,
  scene: WorkspaceScene,
): WorkspaceGridCursor | null {
  const column = adjacentGridCoordinate(
    current.column,
    directionDelta(direction),
  );
  return column === null
    ? null
    : normalizeWorkspaceGridCursor(scene, { ...current, column });
}

function nextVerticalGridCursor(
  current: WorkspaceGridCursor,
  direction: FocusDirection,
  scene: WorkspaceScene,
): WorkspaceGridCursor | null {
  const split = current.split + directionDelta(direction);
  const currentColumn = workspaceColumnAtGridCursor(scene, current);
  if (currentColumn && split >= 0 && split < currentColumn.cells.length) {
    return { ...current, split };
  }

  if (scene.gridAxes === "horizontal") {
    return null;
  }
  const row = adjacentGridCoordinate(current.row, directionDelta(direction));
  if (row === null) return null;
  return normalizeWorkspaceGridCursor(scene, {
    column: current.column,
    row,
    split: 0,
  });
}

function directionDelta(direction: FocusDirection): -1 | 1 {
  return direction === "left" || direction === "up" ? -1 : 1;
}

export function workspaceGridCursorAnnouncement(
  cursor: WorkspaceGridCursor,
  paneTitle: string | null,
): string {
  return `Grid cell (${String(cursor.column)}, ${String(cursor.row)}), split ${String(cursor.split + 1)}: ${paneTitle ?? "Empty cell"}.`;
}

function adjacentGridCoordinate(value: number, delta: -1 | 1): number | null {
  const adjacent = value + delta;
  return Number.isSafeInteger(adjacent) ? adjacent : null;
}

function cursorIsWithinBounds(
  cursor: WorkspaceGridCursor,
  bounds: WorkspaceCursorRunwayBounds,
): boolean {
  return (
    cursor.column >= bounds.minColumn &&
    cursor.column <= bounds.maxColumn &&
    cursor.row >= bounds.minRow &&
    cursor.row <= bounds.maxRow
  );
}

function cursorMovesTowardBounds(
  current: WorkspaceGridCursor,
  next: WorkspaceGridCursor,
  bounds: WorkspaceCursorRunwayBounds,
): boolean {
  return (
    (current.column < bounds.minColumn && next.column > current.column) ||
    (current.column > bounds.maxColumn && next.column < current.column) ||
    (current.row < bounds.minRow && next.row > current.row) ||
    (current.row > bounds.maxRow && next.row < current.row)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
