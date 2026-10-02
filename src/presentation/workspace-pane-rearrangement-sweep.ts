import { worldPaneRenderer } from "./workspace-sweep-geometry.js";
import type { WorkspaceLikeLayoutEngine } from "../layout/layout-engine.js";
import type {
  WorkspaceLayoutSnapshot,
  WorkspacePaneRearrangementSource,
} from "../state/layout-store.js";
import type {
  LayoutEngine,
  PaneId,
  PaneRenderItem,
  PaneWorldBox,
  Rect,
  WorkspaceScene,
  WorkspaceWorldFrame,
} from "../types.js";
import { workspaceGridCursorForPane } from "../workspace/workspace-grid-cursor.js";
import {
  workspaceGeometryOrigin,
  workspaceWorldRenderFrame,
  type WorkspaceRenderItemsInput,
} from "./workspace-render-items.js";

export function workspacePaneRearrangementSweep(
  input: WorkspaceRenderItemsInput & { engine: WorkspaceLikeLayoutEngine },
  items: readonly PaneRenderItem[],
  source: WorkspacePaneRearrangementSource | null,
): { items: PaneRenderItem[]; sourceItems: PaneWorldBox[] } {
  const result = { items: [...items], sourceItems: [] as PaneWorldBox[] };
  if (!activePaneRearrangementSource(source, input.snapshot)) {
    return result;
  }
  const sourceEngine = input.engine.forkForWorldGeometry(source.scene);
  const geometryOrigin = workspaceGeometryOrigin(input);
  const sourceFrame = workspaceWorldRenderFrame({
    ...input,
    engine: sourceEngine,
    geometryOrigin,
    moving: false,
    snapshot: source.snapshot,
  });
  const targetFrame = workspaceWorldRenderFrame({ ...input, geometryOrigin });
  const targetScene = input.engine.toScene();
  const render = worldPaneRenderer(targetScene, input.snapshot);
  const itemIndexByPaneId = new Map(
    result.items.map((item, index) => [item.paneId, index]),
  );
  for (const paneId of source.affectedPaneIds) {
    addPaneRearrangementSweep(paneId, {
      geometryOrigin,
      input,
      itemIndexByPaneId,
      result,
      source,
      sourceEngine,
      sourceFrame,
      targetFrame,
      targetScene,
      render,
    });
  }
  return result;
}

function activePaneRearrangementSource(
  source: WorkspacePaneRearrangementSource | null,
  snapshot: WorkspaceLayoutSnapshot,
): source is WorkspacePaneRearrangementSource {
  return Boolean(
    source &&
    source.revision === snapshot.paneRearrangementRevision &&
    source.affectedPaneIds.length > 0,
  );
}

interface PaneRearrangementSweepContext {
  geometryOrigin: ReturnType<typeof workspaceGeometryOrigin>;
  input: WorkspaceRenderItemsInput & { engine: WorkspaceLikeLayoutEngine };
  itemIndexByPaneId: Map<PaneId, number>;
  result: { items: PaneRenderItem[]; sourceItems: PaneWorldBox[] };
  source: WorkspacePaneRearrangementSource;
  sourceEngine: WorkspaceLikeLayoutEngine;
  sourceFrame: WorkspaceWorldFrame;
  targetFrame: WorkspaceWorldFrame;
  targetScene: WorkspaceScene;
  render: ReturnType<typeof worldPaneRenderer>;
}

function addPaneRearrangementSweep(
  paneId: PaneId,
  context: PaneRearrangementSweepContext,
): void {
  const boxes = paneRearrangementSweepBoxes(paneId, context);
  if (!boxes) {
    return;
  }
  const { from, to } = boxes;
  const existingIndex = context.itemIndexByPaneId.get(paneId);
  const existing =
    existingIndex === undefined
      ? undefined
      : context.result.items[existingIndex];
  const target = existing ?? context.render(to);
  if (!target) {
    return;
  }
  context.result.sourceItems.push(from);
  upsertSweptPane(paneId, existingIndex, target, context);
}

function paneRearrangementSweepBoxes(
  paneId: PaneId,
  context: PaneRearrangementSweepContext,
): { from: PaneWorldBox; to: PaneWorldBox } | null {
  const {
    geometryOrigin,
    input,
    source,
    sourceEngine,
    sourceFrame,
    targetFrame,
    targetScene,
  } = context;
  const from = paneWorldBoxForPane(
    sourceEngine,
    source.scene,
    paneId,
    input.viewport,
    {
      maximizedPaneId: source.snapshot.maximizedPaneId,
      origin: geometryOrigin,
    },
  );
  const to = paneWorldBoxForPane(
    input.engine,
    targetScene,
    paneId,
    input.viewport,
    {
      maximizedPaneId: input.snapshot.maximizedPaneId,
      origin: geometryOrigin,
    },
  );
  return from &&
    to &&
    paneRearrangementSweepsViewport(
      from,
      to,
      sourceFrame,
      targetFrame,
      input.viewport,
    )
    ? { from, to }
    : null;
}

function upsertSweptPane(
  paneId: PaneId,
  existingIndex: number | undefined,
  target: PaneRenderItem,
  context: PaneRearrangementSweepContext,
): void {
  const swept = withRearrangementSweepState(target);
  if (existingIndex === undefined) {
    context.itemIndexByPaneId.set(paneId, context.result.items.length);
    context.result.items.push(swept);
    return;
  }
  context.result.items[existingIndex] = swept;
}

function paneWorldBoxForPane(
  engine: LayoutEngine,
  scene: WorkspaceScene,
  paneId: PaneId,
  viewport: Rect,
  camera: {
    maximizedPaneId: WorkspaceLayoutSnapshot["maximizedPaneId"];
    origin: WorkspaceRenderItemsInput["geometryOrigin"];
  },
): PaneWorldBox | null {
  const cursor = workspaceGridCursorForPane(scene, paneId);
  if (!cursor) {
    return null;
  }
  const cell = engine.gridCellBox(
    cursor,
    viewport,
    camera.maximizedPaneId,
    camera.origin,
  );
  return cell.paneId === paneId
    ? {
        height: cell.height,
        paneId,
        scale: 1,
        width: cell.width,
        x: cell.x,
        y: cell.y,
      }
    : null;
}

function worldPaneBoxIntersectsViewport(
  box: PaneWorldBox,
  frame: WorkspaceWorldFrame,
  viewport: Rect,
): boolean {
  const scale = normalizedScale(box.scale) * normalizedScale(frame.scale);
  const x = frame.x + frame.scale * box.x;
  const y = frame.y + frame.scale * box.y;
  return (
    x + box.width * scale > viewport.x &&
    x < viewport.x + viewport.width &&
    y + box.height * scale > viewport.y &&
    y < viewport.y + viewport.height
  );
}

function paneRearrangementSweepsViewport(
  from: PaneWorldBox,
  to: PaneWorldBox,
  sourceFrame: WorkspaceWorldFrame,
  targetFrame: WorkspaceWorldFrame,
  viewport: Rect,
): boolean {
  return (
    worldPaneBoxIntersectsViewport(from, sourceFrame, viewport) ||
    worldPaneBoxIntersectsViewport(from, targetFrame, viewport) ||
    worldPaneBoxIntersectsViewport(to, sourceFrame, viewport) ||
    worldPaneBoxIntersectsViewport(to, targetFrame, viewport)
  );
}

function withRearrangementSweepState(item: PaneRenderItem): PaneRenderItem {
  return {
    ...item,
    moving: true,
    preload: true,
    runtimeState: "frozen",
    visible: true,
  };
}

function normalizedScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
