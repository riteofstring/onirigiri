import type { WorkspaceColumn } from "../types.js";

export function columnSlotIndex(column: WorkspaceColumn): number {
  return normalizedSlotIndex(column.slotIndex, column.index);
}

export function compareColumnsByPlaneAndSlot(
  left: WorkspaceColumn,
  right: WorkspaceColumn,
): number {
  return (
    left.planeIndex - right.planeIndex ||
    columnSlotIndex(left) - columnSlotIndex(right) ||
    left.index - right.index
  );
}

export function normalizeColumnSlots(
  columns: readonly WorkspaceColumn[],
): WorkspaceColumn[] {
  const usedSlotsByPlane = new Map<number, Set<number>>();
  const nextFallbackSlotByPlane = new Map<number, number>();
  return columns.map((column) => {
    const usedSlots =
      usedSlotsByPlane.get(column.planeIndex) ?? new Set<number>();
    usedSlotsByPlane.set(column.planeIndex, usedSlots);
    const fallbackSlotIndex =
      nextFallbackSlotByPlane.get(column.planeIndex) ?? 0;
    let slotIndex = normalizedSlotIndex(column.slotIndex, fallbackSlotIndex);
    while (usedSlots.has(slotIndex)) {
      slotIndex += 1;
    }
    usedSlots.add(slotIndex);
    nextFallbackSlotByPlane.set(
      column.planeIndex,
      Math.max(fallbackSlotIndex, slotIndex) + 1,
    );
    return {
      ...column,
      slotIndex,
    };
  });
}

function normalizedSlotIndex(
  slotIndex: number | undefined,
  fallbackSlotIndex: number,
): number {
  if (typeof slotIndex !== "number" || !Number.isFinite(slotIndex)) {
    return Math.floor(fallbackSlotIndex);
  }
  return Math.floor(slotIndex);
}

export function nextSlotIndexForPlane(
  planeColumns: readonly WorkspaceColumn[],
): number {
  const lastSlotIndex = Math.max(
    -1,
    ...planeColumns.map((column) => columnSlotIndex(column)),
  );
  return lastSlotIndex + 1;
}

export function insertSlotBeside(
  columns: readonly WorkspaceColumn[],
  planeIndex: number,
  sourceSlotIndex: number,
  step: -1 | 1,
): { columns: WorkspaceColumn[]; slotIndex: number } {
  const slotIndex = sourceSlotIndex + step;
  const occupied = columns.some(
    (column) =>
      column.planeIndex === planeIndex && columnSlotIndex(column) === slotIndex,
  );
  if (!occupied) {
    return { columns: [...columns], slotIndex };
  }
  return {
    columns: columns.map((column) =>
      column.planeIndex === planeIndex &&
      (columnSlotIndex(column) - slotIndex) * step >= 0
        ? { ...column, slotIndex: columnSlotIndex(column) + step }
        : column,
    ),
    slotIndex,
  };
}

export function slotWidthsForColumns({
  columns,
  defaultWidth,
  widths,
}: {
  columns: readonly WorkspaceColumn[];
  defaultWidth: number;
  widths: readonly number[];
}): Map<number, number> {
  const slotWidths = new Map<number, number>();
  for (const column of columns) {
    const slotIndex = columnSlotIndex(column);
    const width = widths[column.index] ?? defaultWidth;
    slotWidths.set(slotIndex, Math.max(slotWidths.get(slotIndex) ?? 0, width));
  }
  return slotWidths;
}
