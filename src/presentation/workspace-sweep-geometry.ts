import type {
  LayoutEngine,
  PaneId,
  PaneRenderItem,
  PaneWorldBox,
  Rect,
  WorkspaceScene,
} from "../types";
import type { WorkspaceLayoutSnapshot } from "../state/layout-store-types";

export function canonicalWorldPaneItems(
  items: readonly PaneRenderItem[],
  worldBoxes: readonly PaneWorldBox[],
): PaneRenderItem[] {
  const boxByPaneId = new Map(worldBoxes.map((box) => [box.paneId, box]));
  return items.map((item) => {
    const box = boxByPaneId.get(item.paneId);
    return box ? { ...item, ...box } : item;
  });
}

export function paneWorldBoxIntersectsRect(
  box: PaneWorldBox,
  rect: Rect,
): boolean {
  const scale = normalizedScale(box.scale);
  return (
    box.x + box.width * scale > rect.x &&
    box.x < rect.x + rect.width &&
    box.y + box.height * scale > rect.y &&
    box.y < rect.y + rect.height
  );
}

export function unionRects(left: Rect | null, right: Rect): Rect {
  if (!left) {
    return { ...right };
  }
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const farX = Math.max(left.x + left.width, right.x + right.width);
  const farY = Math.max(left.y + left.height, right.y + right.height);
  return { height: farY - y, width: farX - x, x, y };
}

function normalizedScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function completePaneShells(
  input: {
    engine: LayoutEngine;
    snapshot: WorkspaceLayoutSnapshot;
    moving: boolean;
  },
  items: PaneRenderItem[],
  worldBoxes: readonly PaneWorldBox[],
): PaneRenderItem[] {
  const rendered = new Set(items.map((item) => item.paneId));
  let render: ReturnType<typeof worldPaneRenderer> | undefined;
  for (const box of worldBoxes) {
    if (rendered.has(box.paneId)) continue;
    render ??= worldPaneRenderer(input.engine.toScene(), input.snapshot);
    const item = render(box);
    if (item) {
      items.push({
        ...item,
        moving: input.moving,
        preload: undefined,
        runtimeState: "hidden",
        visible: false,
      });
    }
  }
  return items;
}

export function worldPaneRenderer(
  scene: WorkspaceScene,
  snapshot: WorkspaceLayoutSnapshot,
): (box: PaneWorldBox) => PaneRenderItem | null {
  let planes: Map<PaneId, number> | undefined;
  return (box) => {
    if (!planes) {
      planes = new Map();
      for (const column of scene.columns)
        for (const cell of column.cells)
          if (cell.paneId !== null && !planes.has(cell.paneId))
            planes.set(cell.paneId, column.planeIndex);
    }
    const paneId = box.paneId;
    const pane = scene.paneById.get(paneId);
    const planeIndex = planes.get(paneId);
    if (!pane || planeIndex === undefined) return null;
    const focused = paneId === snapshot.focusedPaneId;
    return {
      focused,
      height: box.height,
      maximized: paneId === snapshot.maximizedPaneId,
      moving: true,
      opacity: 1,
      paneId,
      planeIndex,
      presentationMode: snapshot.presentationMode,
      preload: true,
      resizing: false,
      runtimeState: "frozen",
      scale: box.scale,
      surfaceId: pane.surfaceId,
      surfaceKind: pane.surfaceKind,
      visible: true,
      width: box.width,
      x: box.x,
      y: box.y,
      z: focused ? 2 : 1,
    };
  };
}
