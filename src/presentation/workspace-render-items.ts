import { WorkspaceLikeLayoutEngine } from "../layout/layout-engine";
import type { WorkspaceLayoutSnapshot } from "../state/layout-store";
import { workspaceScrollRowIsSettled } from "../state/layout-store-animation";
import { interpolatePaneRenderItems } from "./pane-render-interpolation";
import type {
  LayoutEngine,
  LayoutFrameInput,
  PaneRenderItem,
  PaneWorldBox,
  Rect,
  ReservedCellRenderItem,
  WorkspaceGridCursorRenderItem,
  WorkspaceGridOrigin,
  WorkspaceWorldFrame,
  WorkspaceScene,
} from "../types";
import {
  canonicalWorldPaneItems,
  completePaneShells,
  worldPaneRenderer,
  paneWorldBoxIntersectsRect,
  unionRects,
} from "./workspace-sweep-geometry";

export interface WorkspaceRenderItemsInput {
  compactLayout: boolean;
  engine: LayoutEngine;
  geometryOrigin?: WorkspaceGridOrigin;
  moving: boolean;
  snapshot: WorkspaceLayoutSnapshot;
  sweepGrid?: Rect | null;
  viewport: Rect;
}

interface ZoomEndpointFrames {
  key: string;
  normalItems: PaneRenderItem[];
  overviewItems: PaneRenderItem[];
}

export class WorkspaceRenderItemRenderer {
  private worldGeometry: {
    engine: LayoutEngine;
    key: string;
    worldBoxes: readonly PaneWorldBox[];
  } | null = null;
  private zoomEndpointFrames: ZoomEndpointFrames | null = null;
  private readonly sweepCurrent = new WorkspaceWorldFrameRenderer();
  private readonly sweepTarget = new WorkspaceWorldFrameRenderer();

  render(input: WorkspaceRenderItemsInput): PaneRenderItem[] {
    return renderWorkspaceItems(input, this, this.worldBoxes(input));
  }

  worldBoxes(input: WorkspaceRenderItemsInput): readonly PaneWorldBox[] {
    const origin = workspaceGeometryOrigin(input);
    if (!workspaceMotionSceneIsCacheable(input)) {
      return input.engine.paneWorldBoxes(
        input.viewport,
        input.snapshot.maximizedPaneId,
        origin,
      );
    }
    const key = workspaceMotionSceneKey(input);
    if (
      this.worldGeometry?.engine !== input.engine ||
      this.worldGeometry.key !== key
    ) {
      this.sweepCurrent.reset();
      this.sweepTarget.reset();
      this.resetZoomEndpoints();
      this.worldGeometry = {
        engine: input.engine,
        key,
        worldBoxes: input.engine.paneWorldBoxes(
          input.viewport,
          input.snapshot.maximizedPaneId,
          origin,
        ),
      };
    }
    return this.worldGeometry.worldBoxes;
  }

  reset(): void {
    this.worldGeometry = null;
    this.sweepCurrent.reset();
    this.sweepTarget.reset();
    this.resetZoomEndpoints();
  }

  sweepFrame(
    input: WorkspaceRenderItemsInput,
    target: boolean,
  ): WorkspaceWorldFrame {
    if (!workspaceMotionSceneIsCacheable(input))
      return workspaceWorldRenderFrame(input);
    return (target ? this.sweepTarget : this.sweepCurrent).render(input);
  }

  resetZoomEndpoints(): void {
    this.zoomEndpointFrames = null;
  }

  resolveZoomEndpointFrames(
    key: string,
    create: () => Omit<ZoomEndpointFrames, "key">,
  ): ZoomEndpointFrames {
    if (this.zoomEndpointFrames?.key !== key) {
      this.zoomEndpointFrames = { key, ...create() };
    }
    return this.zoomEndpointFrames;
  }
}

interface WorkspaceWorldEndpointFrames {
  key: string;
  normal: WorkspaceWorldFrame;
  overview: WorkspaceWorldFrame;
}

export class WorkspaceWorldFrameRenderer {
  private readonly frames = new Map<string, WorkspaceWorldFrame>();
  private endpoints: WorkspaceWorldEndpointFrames | null = null;

  render(input: WorkspaceRenderItemsInput): WorkspaceWorldFrame {
    const target = input.snapshot.presentationMode === "overview" ? 1 : 0;
    if (Math.abs(input.snapshot.overviewProgress - target) > 0.001) {
      return this.renderOverviewTransition(input);
    }
    this.endpoints = null;
    return this.cachedFrame(input);
  }

  reset(): void {
    this.endpoints = null;
    this.frames.clear();
  }

  private cachedFrame(input: WorkspaceRenderItemsInput): WorkspaceWorldFrame {
    const key = workspaceWorldFrameKey(input);
    const cached = this.frames.get(key);
    if (cached) {
      return cached;
    }
    const frame = workspaceWorldRenderFrame(input);
    this.frames.set(key, frame);
    if (this.frames.size > 4) {
      const oldest = this.frames.keys().next().value as string | undefined;
      if (oldest) {
        this.frames.delete(oldest);
      }
    }
    return frame;
  }

  private renderOverviewTransition(
    input: WorkspaceRenderItemsInput,
  ): WorkspaceWorldFrame {
    const key = zoomEndpointFrameKey(
      input.snapshot,
      input.viewport,
      input.compactLayout,
    );
    if (this.endpoints?.key !== key) {
      this.endpoints = {
        key,
        normal: this.cachedFrame({
          ...input,
          snapshot: {
            ...input.snapshot,
            overviewProgress: 0,
            presentationMode: "normal",
          },
        }),
        overview: this.cachedFrame({
          ...input,
          snapshot: {
            ...input.snapshot,
            overviewProgress: 1,
            presentationMode: "overview",
            scrollColumn: 0,
            scrollRow: 0,
          },
        }),
      };
    }
    return interpolateWorkspaceWorldFrame(
      this.endpoints.normal,
      this.endpoints.overview,
      input.snapshot.overviewProgress,
      input.viewport,
    );
  }
}

export function workspaceRenderItems(
  input: WorkspaceRenderItemsInput,
): PaneRenderItem[] {
  return renderWorkspaceItems(input, null);
}

export function workspaceGridCursorRenderItem({
  engine,
  geometryOrigin,
  snapshot,
  viewport,
}: WorkspaceRenderItemsInput): WorkspaceGridCursorRenderItem {
  const cell = engine.gridCellBox(
    snapshot.cursor,
    viewport,
    snapshot.maximizedPaneId,
    workspaceGeometryOrigin({ engine, geometryOrigin, snapshot }),
  );
  return {
    cursor: cell.cursor,
    height: cell.height,
    kind: cell.kind,
    paneId: cell.paneId,
    presentationMode: snapshot.presentationMode,
    scale: 1,
    structural: cell.structural,
    width: cell.width,
    x: cell.x,
    y: cell.y,
  };
}

export function workspaceWorldRenderFrame({
  engine,
  geometryOrigin,
  moving,
  snapshot,
  viewport,
}: WorkspaceRenderItemsInput): WorkspaceWorldFrame {
  const projectedCursor = screenGridCursorRenderItem({
    engine,
    moving,
    snapshot,
    viewport,
  });
  const canonicalCursor = engine.gridCellBox(
    snapshot.cursor,
    viewport,
    snapshot.maximizedPaneId,
    workspaceGeometryOrigin({ engine, geometryOrigin, snapshot }),
  );
  const scale = normalizedScale(projectedCursor.scale);
  const x = projectedCursor.x - canonicalCursor.x * scale;
  const y = projectedCursor.y - canonicalCursor.y * scale;
  const focalWorldX = canonicalCursor.x + canonicalCursor.width / 2;
  const focalWorldY = canonicalCursor.y + canonicalCursor.height / 2;
  const left = (viewport.x - x) / scale;
  const top = (viewport.y - y) / scale;
  const right = (viewport.x + viewport.width - x) / scale;
  const bottom = (viewport.y + viewport.height - y) / scale;
  return {
    focalScreenX: x + focalWorldX * scale,
    focalScreenY: y + focalWorldY * scale,
    focalWorldX,
    focalWorldY,
    grid: {
      height: Math.max(1, bottom - top),
      width: Math.max(1, right - left),
      x: left,
      y: top,
    },
    scale,
    x,
    y,
  };
}

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

function screenGridCursorRenderItem({
  engine,
  moving,
  snapshot,
  viewport,
}: Omit<
  WorkspaceRenderItemsInput,
  "compactLayout"
>): WorkspaceGridCursorRenderItem {
  const overviewTarget = snapshot.presentationMode === "overview" ? 1 : 0;
  const overviewTransitioning =
    Math.abs(snapshot.overviewProgress - overviewTarget) > 0.001;
  const commonFrame = {
    cursor: snapshot.cursor,
    focusedPaneId: snapshot.focusedPaneId,
    maximizedPaneId: snapshot.maximizedPaneId,
    movementPhase: moving ? ("moving" as const) : ("idle" as const),
    viewport,
  };
  if (!overviewTransitioning) {
    return engine.gridCursorRenderItem({
      ...commonFrame,
      horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
      overviewFollowOffsetX: snapshot.overviewFollowOffsetX,
      overviewFollowOffsetY: snapshot.overviewFollowOffsetY,
      overviewFixedScale: snapshot.overviewFixedScale,
      overviewPanX: snapshot.overviewPanX,
      overviewPanY: snapshot.overviewPanY,
      overviewZoom: snapshot.overviewZoom,
      presentationMode: snapshot.presentationMode,
      scrollColumn: snapshot.scrollColumn,
      scrollRow: snapshot.scrollRow,
      verticalAnchorOffset: snapshot.verticalAnchorOffset,
    });
  }
  const normal = engine.gridCursorRenderItem({
    ...commonFrame,
    horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
    presentationMode: "normal",
    scrollColumn: snapshot.scrollColumn,
    scrollRow: snapshot.scrollRow,
    verticalAnchorOffset: snapshot.verticalAnchorOffset,
  });
  const overview = engine.gridCursorRenderItem({
    ...commonFrame,
    overviewFollowOffsetX: snapshot.overviewFollowOffsetX,
    overviewFollowOffsetY: snapshot.overviewFollowOffsetY,
    overviewFixedScale: snapshot.overviewFixedScale,
    overviewPanX: snapshot.overviewPanX,
    overviewPanY: snapshot.overviewPanY,
    overviewZoom: snapshot.overviewZoom,
    presentationMode: "overview",
    scrollColumn: 0,
    scrollRow: 0,
  });
  return interpolateGridCursorRenderItem(
    normal,
    overview,
    snapshot.overviewProgress,
    snapshot.presentationMode,
  );
}

function renderWorkspaceItems(
  input: WorkspaceRenderItemsInput,
  cache: WorkspaceRenderItemRenderer | null,
  cachedWorldBoxes?: readonly PaneWorldBox[],
): PaneRenderItem[] {
  const worldBoxes =
    cachedWorldBoxes ??
    input.engine.paneWorldBoxes(
      input.viewport,
      input.snapshot.maximizedPaneId,
      workspaceGeometryOrigin(input),
    );
  const current = canonicalWorldPaneItems(
    screenWorkspaceRenderItems(input, cache),
    worldBoxes,
  );
  const targetInput = cameraSweepTargetInput(input);
  const sweepGrid = cameraSweepGrid(input, targetInput, cache);
  if (!targetInput && !sweepGrid) {
    return completePaneShells(input, current, worldBoxes);
  }
  const merged =
    targetInput && cameraSweepNeedsTargetItems(input)
      ? mergeSweptWorldItems(
          current,
          canonicalWorldPaneItems(
            screenWorkspaceRenderItems(targetInput, null),
            worldBoxes,
          ),
          input.moving,
        )
      : current;
  return completePaneShells(
    input,
    sweepGrid
      ? materializeCameraSweep(input, merged, worldBoxes, sweepGrid)
      : merged,
    worldBoxes,
  );
}

function cameraSweepNeedsTargetItems(
  input: WorkspaceRenderItemsInput,
): boolean {
  const target = input.snapshot.presentationMode === "overview" ? 1 : 0;
  return Math.abs(input.snapshot.overviewProgress - target) <= 0.001;
}

function screenWorkspaceRenderItems(
  {
    compactLayout,
    engine,
    moving,
    snapshot,
    viewport,
  }: WorkspaceRenderItemsInput,
  cache: WorkspaceRenderItemRenderer | null,
): PaneRenderItem[] {
  const overviewTarget = snapshot.presentationMode === "overview" ? 1 : 0;
  const overviewTransitioning =
    Math.abs(snapshot.overviewProgress - overviewTarget) > 0.001;
  const commonFrame = {
    cursor: snapshot.cursor,
    focusedPaneId: snapshot.focusedPaneId,
    maximizedPaneId: snapshot.maximizedPaneId,
    movementPhase: moving ? ("moving" as const) : ("idle" as const),
    renderAllColumns: overviewTransitioning,
    viewport,
  };

  if (!overviewTransitioning) {
    cache?.resetZoomEndpoints();
    return applyRuntimeState(
      frameItems(engine, {
        ...commonFrame,
        overviewPanX: snapshot.overviewPanX,
        overviewPanY: snapshot.overviewPanY,
        overviewFollowOffsetX: snapshot.overviewFollowOffsetX,
        overviewFollowOffsetY: snapshot.overviewFollowOffsetY,
        overviewFixedScale: snapshot.overviewFixedScale,
        overviewZoom: snapshot.overviewZoom,
        presentationMode: snapshot.presentationMode,
        horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
        scrollColumn: snapshot.scrollColumn,
        scrollRow: snapshot.scrollRow,
        verticalAnchorOffset: snapshot.verticalAnchorOffset,
      }),
      moving,
      viewport,
      snapshot.presentationMode === "overview",
    );
  }

  const endpointKey = zoomEndpointFrameKey(snapshot, viewport, compactLayout);
  const { normalItems, overviewItems } =
    cache?.resolveZoomEndpointFrames(endpointKey, () =>
      zoomEndpointFrameItems(engine, commonFrame, snapshot),
    ) ?? zoomEndpointFrameItems(engine, commonFrame, snapshot);
  return applyRuntimeState(
    interpolatePaneRenderItems({
      includeSecondaryOnlyItems: snapshot.presentationMode === "overview",
      normalItems,
      overviewItems,
      overviewProgress: snapshot.overviewProgress,
      presentationMode: snapshot.presentationMode,
    }),
    moving,
    viewport,
    true,
  );
}

function cameraSweepTargetInput(
  input: WorkspaceRenderItemsInput,
): WorkspaceRenderItemsInput | null {
  const { snapshot } = input;
  if (!input.moving) {
    return null;
  }
  const overviewTarget = snapshot.presentationMode === "overview" ? 1 : 0;
  if (Math.abs(snapshot.overviewProgress - overviewTarget) > 0.001) {
    return {
      ...input,
      sweepGrid: null,
      snapshot: { ...snapshot, overviewProgress: overviewTarget },
    };
  }
  if (
    snapshot.presentationMode !== "normal" ||
    (Math.abs(snapshot.scrollColumn - snapshot.targetScrollColumn) <= 0.001 &&
      Math.abs(
        snapshot.horizontalAnchorOffset - snapshot.targetHorizontalAnchorOffset,
      ) <= 0.001 &&
      workspaceScrollRowIsSettled(
        snapshot.scrollRow,
        snapshot.targetScrollRow,
      ) &&
      Math.abs(
        snapshot.verticalAnchorOffset - snapshot.targetVerticalAnchorOffset,
      ) <= 0.001)
  ) {
    return null;
  }
  return {
    ...input,
    sweepGrid: null,
    snapshot: {
      ...snapshot,
      horizontalAnchorOffset: snapshot.targetHorizontalAnchorOffset,
      scrollColumn: snapshot.targetScrollColumn,
      scrollRow: snapshot.targetScrollRow,
      verticalAnchorOffset: snapshot.targetVerticalAnchorOffset,
    },
  };
}

function cameraSweepGrid(
  input: WorkspaceRenderItemsInput,
  targetInput: WorkspaceRenderItemsInput | null,
  cache: WorkspaceRenderItemRenderer | null,
): Rect | null {
  let grid = input.sweepGrid ?? null;
  if (!targetInput) {
    return grid;
  }
  grid = unionRects(
    grid,
    (cache?.sweepFrame(input, false) ?? workspaceWorldRenderFrame(input)).grid,
  );
  return unionRects(
    grid,
    (
      cache?.sweepFrame(targetInput, true) ??
      workspaceWorldRenderFrame(targetInput)
    ).grid,
  );
}

function materializeCameraSweep(
  input: WorkspaceRenderItemsInput,
  items: readonly PaneRenderItem[],
  worldBoxes: readonly PaneWorldBox[],
  sweepGrid: Rect,
): PaneRenderItem[] {
  const result = [...items];
  const itemIndexByPaneId = new Map(
    result.map((item, index) => [item.paneId, index]),
  );
  let render: ReturnType<typeof worldPaneRenderer> | undefined;
  for (const box of worldBoxes) {
    if (!paneWorldBoxIntersectsRect(box, sweepGrid)) {
      continue;
    }
    const existingIndex = itemIndexByPaneId.get(box.paneId);
    if (existingIndex !== undefined) {
      const existing = result[existingIndex];
      if (existing) {
        result[existingIndex] = withSweepState(existing, true, true);
      }
      continue;
    }
    render ??= worldPaneRenderer(input.engine.toScene(), input.snapshot);
    const item = render(box);
    if (item) {
      result.push(item);
    }
  }
  return result;
}

function mergeSweptWorldItems(
  current: readonly PaneRenderItem[],
  target: readonly PaneRenderItem[],
  moving: boolean,
): PaneRenderItem[] {
  const targetByPaneId = new Map(target.map((item) => [item.paneId, item]));
  const merged: PaneRenderItem[] = [];
  for (const currentItem of current) {
    const targetItem = targetByPaneId.get(currentItem.paneId);
    if (targetItem) {
      targetByPaneId.delete(currentItem.paneId);
    }
    const visible = currentItem.visible || targetItem?.visible === true;
    merged.push(withSweepState(currentItem, visible, moving));
  }
  for (const targetItem of targetByPaneId.values()) {
    merged.push(withSweepState(targetItem, targetItem.visible, moving));
  }
  return merged;
}

function withSweepState(
  item: PaneRenderItem,
  visible: boolean,
  moving: boolean,
): PaneRenderItem {
  return {
    ...item,
    ...(moving && visible ? { preload: true } : {}),
    runtimeState: !visible ? "hidden" : moving ? "frozen" : item.runtimeState,
    visible,
  };
}

function interpolateGridCursorRenderItem(
  normal: WorkspaceGridCursorRenderItem,
  overview: WorkspaceGridCursorRenderItem,
  overviewProgress: number,
  presentationMode: WorkspaceGridCursorRenderItem["presentationMode"],
): WorkspaceGridCursorRenderItem {
  const progress = clamp(overviewProgress, 0, 1);
  if (progress <= 0) {
    return {
      ...normal,
      presentationMode,
    };
  }
  if (progress >= 1) {
    return {
      ...overview,
      presentationMode,
    };
  }
  const target = presentationMode === "overview" ? overview : normal;
  return {
    ...target,
    height: lerp(normal.height, overview.height, progress),
    presentationMode,
    scale: lerp(normal.scale, overview.scale, progress),
    width: lerp(normal.width, overview.width, progress),
    x: lerp(normal.x, overview.x, progress),
    y: lerp(normal.y, overview.y, progress),
  };
}

function zoomEndpointFrameItems(
  engine: LayoutEngine,
  commonFrame: Omit<
    LayoutFrameInput,
    "presentationMode" | "scrollColumn" | "scrollRow"
  >,
  snapshot: WorkspaceLayoutSnapshot,
): Omit<ZoomEndpointFrames, "key"> {
  return {
    normalItems: frameItems(engine, {
      ...commonFrame,
      horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
      presentationMode: "normal",
      scrollColumn: snapshot.scrollColumn,
      scrollRow: snapshot.scrollRow,
      verticalAnchorOffset: snapshot.verticalAnchorOffset,
    }),
    overviewItems: frameItems(engine, {
      ...commonFrame,
      overviewPanX: snapshot.overviewPanX,
      overviewPanY: snapshot.overviewPanY,
      overviewFollowOffsetX: snapshot.overviewFollowOffsetX,
      overviewFollowOffsetY: snapshot.overviewFollowOffsetY,
      overviewFixedScale: snapshot.overviewFixedScale,
      overviewZoom: snapshot.overviewZoom,
      presentationMode: "overview",
      scrollColumn: 0,
      scrollRow: 0,
    }),
  };
}

function zoomEndpointFrameKey(
  snapshot: WorkspaceLayoutSnapshot,
  viewport: Rect,
  compactLayout: boolean,
): string {
  return [
    snapshot.revision,
    snapshot.focusedPaneId,
    snapshot.cursor.column,
    snapshot.cursor.row,
    snapshot.cursor.split,
    snapshot.maximizedPaneId ?? "",
    snapshot.scrollColumn.toFixed(4),
    snapshot.horizontalAnchorOffset.toFixed(2),
    snapshot.scrollRow.toFixed(4),
    snapshot.verticalAnchorOffset.toFixed(2),
    snapshot.overviewPanX.toFixed(2),
    snapshot.overviewPanY.toFixed(2),
    snapshot.overviewFollowOffsetX.toFixed(2),
    snapshot.overviewFollowOffsetY.toFixed(2),
    snapshot.overviewFixedScale?.toFixed(4) ?? "",
    snapshot.overviewZoom.toFixed(4),
    viewport.x.toFixed(1),
    viewport.y.toFixed(1),
    viewport.width.toFixed(1),
    viewport.height.toFixed(1),
    compactLayout ? "compact" : "desktop",
  ].join("|");
}

function workspaceWorldFrameKey(input: WorkspaceRenderItemsInput): string {
  const { snapshot, viewport } = input;
  return [
    snapshot.layoutRevision,
    snapshot.focusedPaneId ?? "",
    snapshot.cursor.column,
    snapshot.cursor.row,
    snapshot.cursor.split,
    snapshot.maximizedPaneId ?? "",
    snapshot.presentationMode,
    snapshot.horizontalAnchorOffset.toFixed(2),
    snapshot.scrollColumn.toFixed(4),
    snapshot.scrollRow.toFixed(4),
    snapshot.verticalAnchorOffset.toFixed(2),
    snapshot.overviewPanX.toFixed(2),
    snapshot.overviewPanY.toFixed(2),
    snapshot.overviewFollowOffsetX.toFixed(2),
    snapshot.overviewFollowOffsetY.toFixed(2),
    snapshot.overviewFixedScale?.toFixed(4) ?? "",
    snapshot.overviewProgress.toFixed(4),
    snapshot.overviewZoom.toFixed(4),
    viewport.x.toFixed(1),
    viewport.y.toFixed(1),
    viewport.width.toFixed(1),
    viewport.height.toFixed(1),
    input.compactLayout ? "compact" : "desktop",
  ].join("|");
}

function interpolateWorkspaceWorldFrame(
  normal: WorkspaceWorldFrame,
  overview: WorkspaceWorldFrame,
  progressInput: number,
  viewport: Rect,
): WorkspaceWorldFrame {
  const progress = clamp(progressInput, 0, 1);
  const scale = lerp(normal.scale, overview.scale, progress);
  const x = lerp(normal.x, overview.x, progress);
  const y = lerp(normal.y, overview.y, progress);
  const focalWorldX = lerp(normal.focalWorldX, overview.focalWorldX, progress);
  const focalWorldY = lerp(normal.focalWorldY, overview.focalWorldY, progress);
  return {
    focalScreenX: x + focalWorldX * scale,
    focalScreenY: y + focalWorldY * scale,
    focalWorldX,
    focalWorldY,
    grid: {
      height: viewport.height / scale,
      width: viewport.width / scale,
      x: (viewport.x - x) / scale,
      y: (viewport.y - y) / scale,
    },
    scale,
    x,
    y,
  };
}

function frameItems(
  engine: LayoutEngine,
  input: LayoutFrameInput,
): PaneRenderItem[] {
  const items: PaneRenderItem[] = [];
  engine.renderFrame(input, (item) => items.push(item));
  return items;
}

function applyRuntimeState(
  items: PaneRenderItem[],
  moving: boolean,
  viewport: Rect,
  paused: boolean,
): PaneRenderItem[] {
  for (const item of items) {
    const visible = paneIntersectsViewport(item, viewport);
    item.visible = visible;
    item.preload = moving && visible ? true : undefined;
    item.runtimeState = !visible
      ? "hidden"
      : moving || paused
        ? "frozen"
        : "live";
  }
  return items;
}

function paneIntersectsViewport(item: PaneRenderItem, viewport: Rect): boolean {
  if (item.opacity <= 0.001 || item.scale <= 0) {
    return false;
  }
  const right = item.x + item.width * item.scale;
  const bottom = item.y + item.height * item.scale;
  return (
    right > viewport.x &&
    item.x < viewport.x + viewport.width &&
    bottom > viewport.y &&
    item.y < viewport.y + viewport.height
  );
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

function normalizedScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function workspaceMotionSceneKey(
  input: WorkspaceRenderItemsInput,
): string {
  const { snapshot, viewport } = input;
  const origin = workspaceGeometryOrigin(input);
  return [
    snapshot.layoutRevision,
    snapshot.maximizedPaneId ?? "",
    input.engine instanceof WorkspaceLikeLayoutEngine
      ? input.engine.renderConfigurationRevision()
      : "dynamic",
    input.compactLayout ? "compact" : "regular",
    viewport.x,
    viewport.y,
    viewport.width,
    viewport.height,
    origin.column,
    origin.row,
  ].join(":");
}

export function workspaceGeometryOrigin(
  input: Pick<
    WorkspaceRenderItemsInput,
    "engine" | "geometryOrigin" | "snapshot"
  >,
): WorkspaceGridOrigin {
  if (input.geometryOrigin) {
    return input.geometryOrigin;
  }
  return input.engine instanceof WorkspaceLikeLayoutEngine
    ? input.engine.gridGeometryOrigin(input.snapshot.cursor)
    : { column: 0, row: 0 };
}

export function workspaceMotionSceneIsCacheable(
  input: WorkspaceRenderItemsInput,
): boolean {
  return input.engine instanceof WorkspaceLikeLayoutEngine;
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
