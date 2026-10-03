import type { PointerEvent as ReactPointerEvent } from "react";

import type { WorkspaceLayoutStore } from "../state/layout-store.js";
import { paneCellSizingForPane } from "../layout/pane-cell-sizing.js";
import { minimumPaneHeightPx } from "../panes/pane-resize-geometry.js";
import type {
  PaneId,
  PaneRenderItem,
  PaneResizeEdge,
  WorkspaceScene,
} from "../types.js";

export type PaneResizeStart = (
  event: ReactPointerEvent<HTMLButtonElement>,
  item: PaneRenderItem,
  edge: PaneResizeEdge,
  adjacentItem?: PaneRenderItem,
) => void;

interface BeginPaneResizeInput {
  adjacentItem?: PaneRenderItem;
  edge: PaneResizeEdge;
  event: ReactPointerEvent<HTMLButtonElement>;
  item: PaneRenderItem;
  renderItems: readonly PaneRenderItem[];
  scene: WorkspaceScene;
  store: WorkspaceLayoutStore;
}

export function beginPaneResize({
  adjacentItem,
  edge,
  event,
  item,
  renderItems,
  scene,
  store,
}: BeginPaneResizeInput): void {
  event.preventDefault();
  event.stopPropagation();
  store.focusPane(item.paneId);
  const ownerWindow = event.currentTarget.ownerDocument.defaultView;
  if (!ownerWindow) {
    return;
  }
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  handle.setPointerCapture(pointerId);
  store.beginLayoutMutationGroup();
  const move = paneResizeMoveHandler({
    adjacentItem,
    edge,
    item,
    renderItems,
    scene,
    startX: event.clientX,
    startY: event.clientY,
    store,
  });
  const end = () => {
    ownerWindow.removeEventListener("pointermove", move);
    ownerWindow.removeEventListener("pointerup", end);
    ownerWindow.removeEventListener("pointercancel", end);
    handle.removeEventListener("lostpointercapture", end);
    if (handle.hasPointerCapture(pointerId))
      handle.releasePointerCapture(pointerId);
    store.endLayoutMutationGroup();
    store.reanchorFocusedPane();
  };
  ownerWindow.addEventListener("pointermove", move);
  ownerWindow.addEventListener("pointerup", end, { once: true });
  ownerWindow.addEventListener("pointercancel", end, { once: true });
  handle.addEventListener("lostpointercapture", end, { once: true });
}

function paneResizeMoveHandler({
  adjacentItem,
  edge,
  item,
  renderItems,
  scene,
  startX,
  startY,
  store,
}: Omit<BeginPaneResizeInput, "event"> & { startX: number; startY: number }): (
  event: PointerEvent,
) => void {
  if (edge === "left" || edge === "right") {
    return columnResizeMoveHandler(item, edge, startX, store);
  }
  if (!adjacentItem) {
    return rowResizeMoveHandler(
      item,
      edge,
      rowResizeGeometry(item, renderItems, scene),
      startY,
      store,
    );
  }
  return edge === "bottom"
    ? splitResizeMoveHandler(item, adjacentItem, scene, startY, store)
    : splitResizeMoveHandler(adjacentItem, item, scene, startY, store);
}

function columnResizeMoveHandler(
  item: PaneRenderItem,
  edge: "left" | "right",
  startX: number,
  store: WorkspaceLayoutStore,
): (event: PointerEvent) => void {
  const direction = edge === "left" ? -1 : 1;
  return (event) => {
    store.resizePaneColumn(
      item.paneId,
      {
        unit: "px",
        value: Math.max(
          180,
          item.width + (direction * (event.clientX - startX)) / item.scale,
        ),
      },
      edge === "left" ? "end" : "start",
    );
  };
}

function rowResizeMoveHandler(
  item: PaneRenderItem,
  edge: "bottom" | "top",
  geometry: { minimumHeight: number; startHeight: number },
  startY: number,
  store: WorkspaceLayoutStore,
): (event: PointerEvent) => void {
  const direction = edge === "top" ? -1 : 1;
  return (event) => {
    store.resizePaneRow(
      item.paneId,
      Math.max(
        geometry.minimumHeight,
        geometry.startHeight +
          (direction * (event.clientY - startY)) / item.scale,
      ),
      edge === "top" ? "end" : "start",
    );
  };
}

function rowResizeGeometry(
  item: PaneRenderItem,
  renderItems: readonly PaneRenderItem[],
  scene: WorkspaceScene,
): { minimumHeight: number; startHeight: number } {
  const sourceColumn = scene.columns.find((column) =>
    column.cells.some((cell) => cell.paneId === item.paneId),
  );
  const sourcePaneIds = new Set(
    sourceColumn
      ? sourceColumn.cells.flatMap((cell) => (cell.paneId ? [cell.paneId] : []))
      : [item.paneId],
  );
  const sourceItems = renderItems.filter((candidate) =>
    sourcePaneIds.has(candidate.paneId),
  );
  const top = Math.min(item.y, ...sourceItems.map((candidate) => candidate.y));
  const bottom = Math.max(
    item.y + item.height * item.scale,
    ...sourceItems.map(
      (candidate) => candidate.y + candidate.height * candidate.scale,
    ),
  );
  const planeIndex = sourceColumn ? sourceColumn.planeIndex : item.planeIndex;
  const maximumStackSize = Math.max(
    1,
    ...scene.columns
      .filter((column) => column.planeIndex === planeIndex)
      .map(
        (column) => column.cells.filter((cell) => cell.paneId !== null).length,
      ),
  );
  return {
    minimumHeight:
      maximumStackSize * minimumPaneHeightPx +
      Math.max(0, maximumStackSize - 1) * scene.rowGap,
    startHeight: (bottom - top) / item.scale,
  };
}

function splitResizeMoveHandler(
  item: PaneRenderItem,
  adjacentItem: PaneRenderItem,
  scene: WorkspaceScene,
  startY: number,
  store: WorkspaceLayoutStore,
): (event: PointerEvent) => void {
  const pairHeight = item.height + adjacentItem.height;
  const pairWeight = Math.max(
    0.2,
    paneWeight(scene, item.paneId) + paneWeight(scene, adjacentItem.paneId),
  );
  const minimumSplitHeight = Math.min(
    minimumPaneHeightPx,
    Math.max(1, Math.floor((pairHeight - 1) / 2)),
  );
  return (event) => {
    const upperHeight = Math.min(
      pairHeight - minimumSplitHeight,
      Math.max(
        minimumSplitHeight,
        item.height + (event.clientY - startY) / item.scale,
      ),
    );
    const upperWeight = (pairWeight * upperHeight) / Math.max(1, pairHeight);
    store.resizePaneSplit(
      item.paneId,
      adjacentItem.paneId,
      Math.max(0.1, upperWeight),
      Math.max(0.1, pairWeight - upperWeight),
    );
  };
}

function paneWeight(scene: WorkspaceScene, paneId: PaneId): number {
  return paneCellSizingForPane(scene, paneId)?.weight ?? 1;
}
