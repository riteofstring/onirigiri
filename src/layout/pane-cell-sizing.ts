import type {
  PaneCellSizing,
  PaneId,
  WorkspaceColumn,
  WorkspaceScene,
} from "../types.js";

export function paneCellSizingForPane(
  scene: WorkspaceScene,
  paneId: PaneId,
): PaneCellSizing | null {
  for (const column of scene.columns) {
    const rowIndex = column.cells.findIndex((cell) => cell.paneId === paneId);
    if (rowIndex < 0) {
      continue;
    }
    return requiredCellSizing(column, rowIndex);
  }
  return null;
}

function requiredCellSizing(
  column: WorkspaceColumn,
  rowIndex: number,
): PaneCellSizing {
  const cell = column.cells[rowIndex];
  if (!cell) {
    throw new Error(
      `workspace column ${column.columnId} is missing cell ${rowIndex}`,
    );
  }
  return cell.heightPx === undefined
    ? { weight: cell.weight }
    : { heightPx: cell.heightPx, weight: cell.weight };
}
