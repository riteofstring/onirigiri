import { distributePaneHeights } from "../panes/pane-resize-geometry.js";
import type { PaneLocation } from "./layout-engine-helpers.js";
import type { PaneId, WorkspaceCell } from "../types.js";

export function isOrdinaryOccupiedCell(
  cell: WorkspaceCell | undefined,
): cell is WorkspaceCell & { paneId: PaneId; reserved: false } {
  return cell !== undefined && cell.paneId !== null && cell.reserved === false;
}

export function emptyPaneMoveCell(sourceCell: WorkspaceCell): WorkspaceCell {
  return {
    ...(sourceCell.heightPx === undefined
      ? {}
      : { heightPx: sourceCell.heightPx }),
    paneId: null,
    reserved: false,
    weight: sourceCell.weight,
  };
}

export function finiteFrameValue(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function locationsFormAdjacentSplit(
  upperLocation: PaneLocation | null,
  lowerLocation: PaneLocation | null,
): boolean {
  if (!upperLocation || !lowerLocation) {
    return false;
  }
  return (
    upperLocation.columnIndex === lowerLocation.columnIndex &&
    lowerLocation.rowIndex === upperLocation.rowIndex + 1
  );
}

export function resizedSplitSizing(
  upperSizing: { heightPx?: number; weight: number },
  lowerSizing: { heightPx?: number; weight: number },
  upperWeight: number,
  lowerWeight: number,
): [
  { heightPx?: number; weight: number },
  { heightPx?: number; weight: number },
] {
  const heights = resizedSplitHeights(
    upperSizing,
    lowerSizing,
    upperWeight,
    lowerWeight,
  );
  return [
    { heightPx: heights?.[0], weight: upperWeight },
    { heightPx: heights?.[1], weight: lowerWeight },
  ];
}

function resizedSplitHeights(
  upperSizing: { heightPx?: number },
  lowerSizing: { heightPx?: number },
  upperWeight: number,
  lowerWeight: number,
): [number, number] | undefined {
  if (
    upperSizing.heightPx === undefined ||
    lowerSizing.heightPx === undefined
  ) {
    return undefined;
  }
  const [upperHeight, lowerHeight] = distributePaneHeights(
    upperSizing.heightPx + lowerSizing.heightPx,
    [upperWeight, lowerWeight],
  );
  return [upperHeight ?? 0, lowerHeight ?? 0];
}

export function placementToDirection(
  placement: "above" | "below",
): "up" | "down" {
  return placement === "above" ? "up" : "down";
}
