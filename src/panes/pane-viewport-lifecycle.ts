import type { WorkspaceLayoutSnapshot } from "../state/layout-store";
import type {
  PaneId,
  PaneRenderItem,
  Rect,
  WorkspacePane,
  WorkspaceWorldFrame,
} from "../types";

interface RetainedPaneEntry {
  area: number;
  item: PaneRenderItem;
  lastVisibleSequence: number;
}

interface ResolvePaneViewportInput {
  items: readonly PaneRenderItem[];
  mountContentDuringMotion?: boolean;
  liveContent?: boolean;
  livePresentation?: boolean;
  moving: boolean;
  panes: readonly WorkspacePane[];
  snapshot: WorkspaceLayoutSnapshot;
  targetWorldFrame?: WorkspaceWorldFrame;
  viewport: Rect;
}

interface MotionContentMounting {
  enabled: boolean;
  liveContent: boolean;
  livePresentation: boolean;
  targetWorldFrame: WorkspaceWorldFrame | undefined;
  viewport: Rect;
}

export class PaneViewportLifecycle {
  private readonly entries = new Map<PaneId, RetainedPaneEntry>();
  private paneOrderById = new Map<PaneId, number>();
  private panes: readonly WorkspacePane[] | null = null;
  private sequence = 0;

  constructor(
    private retainedAreaBudgetViewports: number,
    private readonly hasPicture: (paneId: PaneId) => boolean = () => false,
  ) {}

  setRetainedAreaBudgetViewports(value: number): void {
    this.retainedAreaBudgetViewports = normalizedAreaBudget(value);
  }

  resolve({
    items,
    mountContentDuringMotion = false,
    liveContent = false,
    livePresentation = false,
    moving,
    panes,
    snapshot,
    targetWorldFrame,
    viewport,
  }: ResolvePaneViewportInput): PaneRenderItem[] {
    this.sequence += 1;
    this.synchronizePanes(panes);
    this.retainRenderedItems(items, moving, {
      enabled: mountContentDuringMotion,
      liveContent,
      livePresentation,
      targetWorldFrame,
      viewport,
    });
    const itemByPaneId = new Map(items.map((item) => [item.paneId, item]));
    this.parkUnrenderedEntries(itemByPaneId, moving, snapshot);
    if (!moving && !liveContent) {
      this.evictIdleOffscreenEntries(viewport, snapshot.focusedPaneId);
    }
    return this.mountedItems();
  }

  retainedPaneIds(): readonly PaneId[] {
    return [...this.entries.keys()];
  }

  private synchronizePanes(panes: readonly WorkspacePane[]): void {
    if (this.panes === panes) {
      return;
    }
    this.panes = panes;
    this.paneOrderById = new Map(
      panes.map((pane, index) => [pane.paneId, index]),
    );
    for (const paneId of this.entries.keys()) {
      if (!this.paneOrderById.has(paneId)) {
        this.entries.delete(paneId);
      }
    }
  }

  private retainRenderedItems(
    items: readonly PaneRenderItem[],
    moving: boolean,
    motionContentMounting: MotionContentMounting,
  ): void {
    for (const item of items) {
      this.retainRenderedItem(item, moving, motionContentMounting);
    }
  }

  private retainRenderedItem(
    item: PaneRenderItem,
    moving: boolean,
    motionContentMounting: MotionContentMounting,
  ): void {
    const retained = this.entries.get(item.paneId);
    if (
      !retained &&
      !motionContentMounting.liveContent &&
      !(motionContentMounting.livePresentation && item.visible) &&
      !mountsOnFirstRender(item, moving)
    ) {
      return;
    }
    this.entries.set(
      item.paneId,
      retainedPaneEntry(
        item,
        retained,
        this.sequence,
        moving,
        motionContentMounting,
      ),
    );
  }

  private parkUnrenderedEntries(
    itemByPaneId: ReadonlyMap<PaneId, PaneRenderItem>,
    moving: boolean,
    snapshot: WorkspaceLayoutSnapshot,
  ): void {
    for (const [paneId, retained] of this.entries) {
      if (!itemByPaneId.has(paneId)) {
        const parkedItem = parkPaneRenderItem(retained.item, moving, snapshot);
        if (!parkedReactItemCanBeReused(retained.item, parkedItem)) {
          retained.item = parkedItem;
        }
      }
    }
  }

  private mountedItems(): PaneRenderItem[] {
    return [...this.entries.entries()]
      .toSorted(
        ([leftPaneId], [rightPaneId]) =>
          (this.paneOrderById.get(leftPaneId) ?? Number.MAX_SAFE_INTEGER) -
          (this.paneOrderById.get(rightPaneId) ?? Number.MAX_SAFE_INTEGER),
      )
      .map(([, entry]) => entry.item);
  }

  private evictIdleOffscreenEntries(
    viewport: Rect,
    focusedPaneId: PaneId | null,
  ): void {
    for (const [paneId, entry] of this.offscreenEntriesExcept(focusedPaneId)) {
      if (entry.item.placeholderOnly === true) {
        this.entries.delete(paneId);
      }
    }
    const budget = retainedAreaBudget(
      viewport,
      this.retainedAreaBudgetViewports,
    );
    let retainedArea = [...this.entries.values()].reduce(
      (total, entry) => total + retainedContentArea(entry),
      0,
    );
    if (retainedArea <= budget) {
      return;
    }
    const evictionCandidates = this.offscreenEntriesExcept(
      focusedPaneId,
    ).toSorted(
      ([leftId, left], [rightId, right]) =>
        Number(this.hasPicture(rightId)) - Number(this.hasPicture(leftId)) ||
        left.lastVisibleSequence - right.lastVisibleSequence,
    );
    for (const [paneId, entry] of evictionCandidates) {
      if (retainedArea <= budget) {
        break;
      }
      this.entries.delete(paneId);
      retainedArea -= retainedContentArea(entry);
    }
  }

  private offscreenEntriesExcept(
    focusedPaneId: PaneId | null,
  ): [PaneId, RetainedPaneEntry][] {
    return [...this.entries.entries()].filter(
      ([paneId, entry]) => !entry.item.visible && paneId !== focusedPaneId,
    );
  }
}

function mountsOnFirstRender(item: PaneRenderItem, moving: boolean): boolean {
  return item.focused || item.preload === true || (!moving && item.visible);
}

function retainedPaneEntry(
  item: PaneRenderItem,
  retained: RetainedPaneEntry | undefined,
  sequence: number,
  moving: boolean,
  motionContentMounting: MotionContentMounting,
): RetainedPaneEntry {
  const surfaceItem = paneSurfaceItem(
    item,
    retained,
    moving,
    motionContentMounting,
  );
  return {
    area: retainedDomArea(surfaceItem),
    item: retainedReactItem(surfaceItem, retained),
    lastVisibleSequence: surfaceItem.visible
      ? sequence
      : (retained?.lastVisibleSequence ?? sequence),
  };
}

function paneSurfaceItem(
  item: PaneRenderItem,
  retained: RetainedPaneEntry | undefined,
  moving: boolean,
  motionContentMounting: MotionContentMounting,
): PaneRenderItem {
  if (
    motionContentMounting.liveContent ||
    (motionContentMounting.livePresentation && item.visible)
  )
    return withPlaceholderOnly(item, false);
  if (item.presentationMode === "overview") {
    return withPlaceholderOnly(item, !retainedContentIsMounted(retained));
  }
  if (!retained) {
    return moving && !motionContentMounts(item, motionContentMounting)
      ? { ...item, placeholderOnly: true }
      : item;
  }
  return withPlaceholderOnly(
    item,
    !retainedSurfaceRequired(item, retained, moving, motionContentMounting),
  );
}

function retainedSurfaceRequired(
  item: PaneRenderItem,
  retained: RetainedPaneEntry,
  moving: boolean,
  motionContentMounting: MotionContentMounting,
): boolean {
  return (
    retainedContentIsMounted(retained) ||
    (moving
      ? motionContentMounts(item, motionContentMounting)
      : item.visible && item.runtimeState !== "hidden")
  );
}

function retainedContentIsMounted(
  retained: RetainedPaneEntry | undefined,
): boolean {
  return retained !== undefined && retained.item.placeholderOnly !== true;
}

function motionContentMounts(
  item: PaneRenderItem,
  { enabled, targetWorldFrame, viewport }: MotionContentMounting,
): boolean {
  if (item.focused) {
    return true;
  }
  if (!enabled || item.preload !== true) {
    return false;
  }
  return (
    targetWorldFrame === undefined ||
    distanceFromViewport(item, viewport, targetWorldFrame) <= 0
  );
}

function withPlaceholderOnly(
  item: PaneRenderItem,
  placeholderOnly: boolean,
): PaneRenderItem {
  return (item.placeholderOnly === true) === placeholderOnly
    ? item
    : {
        ...item,
        placeholderOnly: placeholderOnly ? true : undefined,
      };
}

function retainedReactItem(
  item: PaneRenderItem,
  retained: RetainedPaneEntry | undefined,
): PaneRenderItem {
  return retained && retainedReactItemCanBeReused(retained.item, item)
    ? retained.item
    : item;
}

function retainedReactItemCanBeReused(
  previous: PaneRenderItem,
  next: PaneRenderItem,
): boolean {
  return (
    parkedReactItemCanBeReused(previous, next) ||
    frozenVisibleReactItemCanBeReused(previous, next)
  );
}

function parkedReactItemCanBeReused(
  previous: PaneRenderItem,
  next: PaneRenderItem,
): boolean {
  return (
    previous.paneId === next.paneId &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.placeholderOnly === next.placeholderOnly &&
    !previous.visible &&
    !next.visible &&
    previous.runtimeState === "hidden" &&
    next.runtimeState === "hidden"
  );
}

function frozenVisibleReactItemCanBeReused(
  previous: PaneRenderItem,
  next: PaneRenderItem,
): boolean {
  return (
    frozenVisibleMotionIdentityIsStable(previous, next) &&
    isUnfocusedFrozenVisibleMotion(previous) &&
    isUnfocusedFrozenVisibleMotion(next)
  );
}

function frozenVisibleMotionIdentityIsStable(
  previous: PaneRenderItem,
  next: PaneRenderItem,
): boolean {
  return (
    previous.paneId === next.paneId &&
    previous.maximized === next.maximized &&
    previous.placeholderOnly === next.placeholderOnly &&
    previous.presentationMode === next.presentationMode
  );
}

function isUnfocusedFrozenVisibleMotion(item: PaneRenderItem): boolean {
  return (
    item.visible &&
    item.moving &&
    !item.focused &&
    item.runtimeState === "frozen"
  );
}

function parkPaneRenderItem(
  item: PaneRenderItem,
  moving: boolean,
  snapshot: WorkspaceLayoutSnapshot,
): PaneRenderItem {
  return {
    ...item,
    focused: item.paneId === snapshot.focusedPaneId,
    maximized: item.paneId === snapshot.maximizedPaneId,
    moving,
    opacity: 0,
    presentationMode: snapshot.presentationMode,
    runtimeState: "hidden",
    visible: false,
    z: item.paneId === snapshot.focusedPaneId ? 2 : 1,
  };
}

function retainedDomArea(item: PaneRenderItem): number {
  return Math.max(1, item.width * item.height);
}

function retainedContentArea(entry: RetainedPaneEntry): number {
  return entry.item.placeholderOnly === true ? 0 : entry.area;
}

function distanceFromViewport(
  item: PaneRenderItem,
  viewport: Rect,
  worldFrame: WorkspaceWorldFrame | undefined,
): number {
  const worldScale = worldFrame?.scale ?? 1;
  const scale = Math.max(0, item.scale * worldScale);
  const x = (worldFrame?.x ?? 0) + item.x * worldScale;
  const y = (worldFrame?.y ?? 0) + item.y * worldScale;
  const right = x + item.width * scale;
  const bottom = y + item.height * scale;
  const horizontal = Math.max(
    0,
    viewport.x - right,
    x - (viewport.x + viewport.width),
  );
  const vertical = Math.max(
    0,
    viewport.y - bottom,
    y - (viewport.y + viewport.height),
  );
  return horizontal * horizontal + vertical * vertical;
}

function retainedAreaBudget(viewport: Rect, budgetViewports: number): number {
  return (
    Math.max(1, viewport.width * viewport.height) *
    normalizedAreaBudget(budgetViewports)
  );
}

function normalizedAreaBudget(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : 8;
}

export function retainedPaneShells(
  items: readonly PaneRenderItem[],
  retained: readonly PaneRenderItem[],
): PaneRenderItem[] {
  const byId = new Map(retained.map((item) => [item.paneId, item]));
  return items.map(
    (item) => byId.get(item.paneId) ?? { ...item, placeholderOnly: true },
  );
}
