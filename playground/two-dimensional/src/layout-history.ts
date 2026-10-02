import type { OnirigiriLayout } from "@riteofstring/onirigiri";

interface LayoutHistory {
  entries: OnirigiriLayout[];
  index: number;
  mutationIds: number[];
}

export const layoutHistoryLimit = 24;

export function emptyLayoutHistory(): LayoutHistory {
  return { entries: [], index: -1, mutationIds: [] };
}

export function initializeLayoutHistory(
  history: LayoutHistory,
  layout: OnirigiriLayout,
): boolean {
  if (history.entries.length > 0) {
    return false;
  }
  history.entries = [layout];
  history.index = 0;
  history.mutationIds = [0];
  return true;
}

export function recordLayoutHistory(
  history: LayoutHistory,
  layout: OnirigiriLayout,
  mutationId: number,
): boolean {
  const current = history.entries[history.index];
  if (history.mutationIds[history.index] === mutationId) {
    history.entries[history.index] = layout;
    return false;
  }
  if (current && layoutsMatch(current, layout)) {
    return false;
  }
  const entries = [...history.entries.slice(0, history.index + 1), layout];
  const mutationIds = [
    ...history.mutationIds.slice(0, history.index + 1),
    mutationId,
  ];
  history.entries = entries.slice(-layoutHistoryLimit);
  history.mutationIds = mutationIds.slice(-layoutHistoryLimit);
  history.index = history.entries.length - 1;
  return true;
}

export function adjacentHistoryLayout(
  history: LayoutHistory,
  direction: "redo" | "undo",
): OnirigiriLayout | null {
  const nextIndex = history.index + (direction === "undo" ? -1 : 1);
  const layout = history.entries[nextIndex];
  if (!layout) {
    return null;
  }
  history.index = nextIndex;
  return layout;
}

function layoutsMatch(left: OnirigiriLayout, right: OnirigiriLayout): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
