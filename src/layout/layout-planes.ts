import type { WorkspaceColumn } from "../types.js";

interface PlaneInsertionResult {
  columns: WorkspaceColumn[];
  planeIndex: number;
}

export function denselyReindexPlanes(
  columns: readonly WorkspaceColumn[],
): WorkspaceColumn[] {
  const planeIndexByExistingIndex = new Map(
    planeIndexesForColumns(columns).map((planeIndex, denseIndex) => [
      planeIndex,
      denseIndex,
    ]),
  );
  return columns.map((column) => ({
    ...column,
    planeIndex:
      planeIndexByExistingIndex.get(column.planeIndex) ?? column.planeIndex,
  }));
}

export function insertPlaneBeside(
  columns: readonly WorkspaceColumn[],
  sourcePlaneIndex: number,
  step: -1 | 1,
): PlaneInsertionResult {
  if (!Number.isFinite(sourcePlaneIndex)) {
    throw new Error(
      `workspace layout plane index must be finite, got ${String(sourcePlaneIndex)}`,
    );
  }
  const planeIndex = Math.floor(sourcePlaneIndex) + step;
  if (!columns.some((column) => column.planeIndex === planeIndex)) {
    return { columns: [...columns], planeIndex };
  }
  return {
    columns: columns.map((column) =>
      (column.planeIndex - planeIndex) * step >= 0
        ? { ...column, planeIndex: column.planeIndex + step }
        : column,
    ),
    planeIndex,
  };
}

export function planeIndexesForColumns(
  columns: readonly WorkspaceColumn[],
): number[] {
  return [...new Set(columns.map((column) => column.planeIndex))].toSorted(
    (left, right) => left - right,
  );
}
