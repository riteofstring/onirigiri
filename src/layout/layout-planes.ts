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

export function insertPlaneAt(
  columns: readonly WorkspaceColumn[],
  requestedPlaneIndex: number,
): PlaneInsertionResult {
  const denseColumns = denselyReindexPlanes(columns);
  const planeIndex = normalizedInsertionIndex(
    requestedPlaneIndex,
    planeIndexesForColumns(denseColumns).length,
  );
  return {
    columns: denseColumns.map((column) =>
      column.planeIndex >= planeIndex
        ? { ...column, planeIndex: column.planeIndex + 1 }
        : column,
    ),
    planeIndex,
  };
}

export function removePlaneAt(
  columns: readonly WorkspaceColumn[],
  planeIndex: number,
): WorkspaceColumn[] {
  if (!Number.isFinite(planeIndex)) {
    return denselyReindexPlanes(columns);
  }
  const removedPlaneIndex = Math.floor(planeIndex);
  return denselyReindexPlanes(
    columns.filter((column) => column.planeIndex !== removedPlaneIndex),
  );
}

export function planeIndexesForColumns(
  columns: readonly WorkspaceColumn[],
): number[] {
  return [...new Set(columns.map((column) => column.planeIndex))].toSorted(
    (left, right) => left - right,
  );
}

function normalizedInsertionIndex(
  requestedPlaneIndex: number,
  planeCount: number,
): number {
  if (!Number.isFinite(requestedPlaneIndex)) {
    throw new Error(
      `workspace layout plane index must be finite, got ${String(requestedPlaneIndex)}`,
    );
  }
  return Math.min(planeCount, Math.max(0, Math.floor(requestedPlaneIndex)));
}
