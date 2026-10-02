import type { PointerEvent as ReactPointerEvent } from "react";

import type { WorkspaceLayoutStore } from "../state/layout-store";
import { paneCellSizingForPane } from "../layout/pane-cell-sizing";
import { minimumPaneHeightPx } from "../panes/pane-resize-geometry";
import type { PaneId, PaneRenderItem, WorkspaceScene } from "../types";

export type ResizeAxis = "column" | "row" | "split";

export type PaneResizeStart = (
  event: ReactPointerEvent<HTMLButtonElement>,
  item: PaneRenderItem,
  axis: ResizeAxis,
  adjacentItem?: PaneRenderItem,
) => void;

interface BeginPaneResizeInput {
  adjacentItem?: PaneRenderItem;
  axis: ResizeAxis;
  event: ReactPointerEvent<HTMLButtonElement>;
  item: PaneRenderItem;
  renderItems: readonly PaneRenderItem[];
  scene: WorkspaceScene;
  store: WorkspaceLayoutStore;
}

export function beginPaneResize({
  adjacentItem,
  axis,
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
    axis,
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
  axis,
  item,
  renderItems,
  scene,
  startX,
  startY,
  store,
}: Omit<BeginPaneResizeInput, "event"> & { startX: number; startY: number }): (
  event: PointerEvent,
) => void {
  if (axis === "column") {
    return columnResizeMoveHandler(item, startX, store);
  }
  if (axis === "row") {
    return rowResizeMoveHandler(item, renderItems, scene, startY, store);
  }
  if (!adjacentItem) {
    return () => undefined;
  }
  return splitResizeMoveHandler(item, adjacentItem, scene, startY, store);
}

function columnResizeMoveHandler(
  item: PaneRenderItem,
  startX: number,
  store: WorkspaceLayoutStore,
): (event: PointerEvent) => void {
  return (event) => {
    store.resizePaneColumn(item.paneId, {
      unit: "px",
      value: Math.max(180, item.width + (event.clientX - startX) / item.scale),
    });
  };
}

function rowResizeMoveHandler(
  item: PaneRenderItem,
  renderItems: readonly PaneRenderItem[],
  scene: WorkspaceScene,
  startY: number,
  store: WorkspaceLayoutStore,
): (event: PointerEvent) => void {
  const geometry = rowResizeGeometry(item, renderItems, scene);
  return (event) => {
    store.resizePaneRow(
      item.paneId,
      Math.max(
        geometry.minimumHeight,
        geometry.startHeight + (event.clientY - startY) / item.scale,
      ),
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
