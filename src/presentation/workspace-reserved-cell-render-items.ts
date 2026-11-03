import { WorkspaceLikeLayoutEngine } from "../layout/layout-engine.js";

import type {
  LayoutFrameInput,
  ReservedCellRenderItem,
  WorkspaceGridOrigin,
  WorkspaceScene,
} from "../types.js";

import {
  workspaceGeometryOrigin,
  type WorkspaceRenderItemsInput,
} from "./workspace-render-items.js";

export function workspaceReservedCellRenderItems(
  input: Omit<WorkspaceRenderItemsInput, "engine"> & {
    engine: WorkspaceLikeLayoutEngine;
  },
): ReservedCellRenderItem[] {
  const items = screenReservedCellRenderItems(input);
  if (items.length === 0) return items;
  const scene = input.engine.toScene();
  const origin = workspaceGeometryOrigin(input);
  return items.map((item) =>
    canonicalWorldReservedCell(item, input, scene, origin),
  );
}

function screenReservedCellRenderItems(
  input: Omit<WorkspaceRenderItemsInput, "engine"> & {
    engine: WorkspaceLikeLayoutEngine;
  },
): ReservedCellRenderItem[] {
  const { snapshot } = input;
  const overviewTarget = snapshot.presentationMode === "overview" ? 1 : 0;
  const overviewTransitioning =
    Math.abs(snapshot.overviewProgress - overviewTarget) > 0.001;
  if (!overviewTransitioning) {
    return frameReservedCellItems(input.engine, reservedCellFrame(input));
  }
  const normal = frameReservedCellItems(
    input.engine,
    reservedCellFrame(input, {
      horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
      presentationMode: "normal",
      scrollColumn: snapshot.scrollColumn,
      scrollRow: snapshot.scrollRow,
      verticalAnchorOffset: snapshot.verticalAnchorOffset,
    }),
  );
  const overview = frameReservedCellItems(
    input.engine,
    reservedCellFrame(input, {
      overviewFixedScale: snapshot.overviewFixedScale,
      overviewFollowOffsetX: snapshot.overviewFollowOffsetX,
      overviewFollowOffsetY: snapshot.overviewFollowOffsetY,
      overviewPanX: snapshot.overviewPanX,
      overviewPanY: snapshot.overviewPanY,
      overviewZoom: snapshot.overviewZoom,
      presentationMode: "overview",
      scrollColumn: 0,
      scrollRow: 0,
    }),
  );
  return interpolateReservedCellRenderItems(
    normal,
    overview,
    snapshot.overviewProgress,
    snapshot.presentationMode,
  );
}

function reservedCellFrame(
  input: Omit<WorkspaceRenderItemsInput, "engine">,
  overrides: Partial<LayoutFrameInput> = {},
): LayoutFrameInput {
  const { snapshot } = input;
  return {
    cursor: snapshot.cursor,
    focusedPaneId: snapshot.focusedPaneId,
    horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
    maximizedPaneId: snapshot.maximizedPaneId,
    movementPhase: input.moving ? "moving" : "idle",
    overviewFixedScale: snapshot.overviewFixedScale,
    overviewFollowOffsetX: snapshot.overviewFollowOffsetX,
    overviewFollowOffsetY: snapshot.overviewFollowOffsetY,
    overviewPanX: snapshot.overviewPanX,
    overviewPanY: snapshot.overviewPanY,
    overviewZoom: snapshot.overviewZoom,
    presentationMode: snapshot.presentationMode,
    scrollColumn: snapshot.scrollColumn,
    scrollRow: snapshot.scrollRow,
    verticalAnchorOffset: snapshot.verticalAnchorOffset,
    viewport: input.viewport,
    ...overrides,
  };
}

function frameReservedCellItems(
  engine: WorkspaceLikeLayoutEngine,
  frame: LayoutFrameInput,
): ReservedCellRenderItem[] {
  return engine.reservedCellRenderItems(frame);
}

function interpolateReservedCellRenderItems(
  normalItems: readonly ReservedCellRenderItem[],
  overviewItems: readonly ReservedCellRenderItem[],
  overviewProgress: number,
  presentationMode: ReservedCellRenderItem["presentationMode"],
): ReservedCellRenderItem[] {
  const progress = clamp(overviewProgress, 0, 1);
  if (progress <= 0) {
    return withReservedCellPresentationMode(normalItems, presentationMode);
  }
  if (progress >= 1) {
    return withReservedCellPresentationMode(overviewItems, presentationMode);
  }
  const normalByKey = new Map(
    normalItems.map((item) => [reservedCellRenderItemKey(item), item]),
  );
  const overviewByKey = new Map(
    overviewItems.map((item) => [reservedCellRenderItemKey(item), item]),
  );
  const keys = new Set([...normalByKey.keys(), ...overviewByKey.keys()]);
  return [...keys].flatMap((key) => {
    const normal = normalByKey.get(key);
    const overview = overviewByKey.get(key);
    if (!normal || !overview) {
      const item = overview ?? normal;
      return item ? [{ ...item, presentationMode }] : [];
    }
    const target = presentationMode === "overview" ? overview : normal;
    return [
      {
        ...target,
        height: lerp(normal.height, overview.height, progress),
        presentationMode,
        scale: lerp(normal.scale, overview.scale, progress),
        width: lerp(normal.width, overview.width, progress),
        x: lerp(normal.x, overview.x, progress),
        y: lerp(normal.y, overview.y, progress),
      },
    ];
  });
}

function withReservedCellPresentationMode(
  items: readonly ReservedCellRenderItem[],
  presentationMode: ReservedCellRenderItem["presentationMode"],
): ReservedCellRenderItem[] {
  return items.map((item) =>
    item.presentationMode === presentationMode
      ? item
      : { ...item, presentationMode },
  );
}

function reservedCellRenderItemKey(item: ReservedCellRenderItem): string {
  return `${item.columnId}:${item.planeIndex}:${item.rowIndex}`;
}

function canonicalWorldReservedCell(
  item: ReservedCellRenderItem,
  input: Omit<WorkspaceRenderItemsInput, "engine"> & {
    engine: WorkspaceLikeLayoutEngine;
  },
  scene: WorkspaceScene,
  origin: WorkspaceGridOrigin,
): ReservedCellRenderItem {
  const column = scene.columns.find(
    (candidate) => candidate.columnId === item.columnId,
  );
  if (!column) {
    return item;
  }
  const cell = input.engine.gridCellBox(
    {
      column: column.slotIndex ?? 0,
      row: item.planeIndex,
      split: item.rowIndex,
    },
    input.viewport,
    input.snapshot.maximizedPaneId,
    origin,
  );
  return {
    ...item,
    height: cell.height,
    scale: 1,
    width: cell.width,
    x: cell.x,
    y: cell.y,
  };
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
