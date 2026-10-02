import type {
  PaneId,
  PaneRenderItem,
  WorkspacePresentationMode,
} from "../types";

interface PaneRenderInterpolationInput {
  includeSecondaryOnlyItems?: boolean;
  normalItems: readonly PaneRenderItem[];
  overviewItems: readonly PaneRenderItem[];
  overviewProgress: number;
  presentationMode: WorkspacePresentationMode;
}

export function interpolatePaneRenderItems({
  includeSecondaryOnlyItems = true,
  normalItems,
  overviewItems,
  overviewProgress,
  presentationMode,
}: PaneRenderInterpolationInput): PaneRenderItem[] {
  const progress = clamp(overviewProgress, 0, 1);
  if (progress <= 0) {
    return withPresentationMode(normalItems, presentationMode);
  }
  if (progress >= 1) {
    return withPresentationMode(overviewItems, presentationMode);
  }

  const normalByPaneId = itemMap(normalItems);
  const overviewByPaneId = itemMap(overviewItems);
  return orderedPaneIds(
    normalItems,
    overviewItems,
    presentationMode,
    includeSecondaryOnlyItems,
  ).map((paneId) =>
    interpolatePaneRenderItem({
      normalItem: normalByPaneId.get(paneId),
      overviewItem: overviewByPaneId.get(paneId),
      overviewProgress: progress,
      paneId,
      presentationMode,
    }),
  );
}

function withPresentationMode(
  items: readonly PaneRenderItem[],
  presentationMode: WorkspacePresentationMode,
): PaneRenderItem[] {
  return items.map((item) =>
    item.presentationMode === presentationMode
      ? item
      : { ...item, presentationMode },
  );
}

function itemMap(
  items: readonly PaneRenderItem[],
): Map<PaneId, PaneRenderItem> {
  return new Map(items.map((item) => [item.paneId, item]));
}

function interpolatePaneRenderItem({
  normalItem,
  overviewItem,
  overviewProgress,
  paneId,
  presentationMode,
}: {
  normalItem: PaneRenderItem | undefined;
  overviewItem: PaneRenderItem | undefined;
  overviewProgress: number;
  paneId: PaneId;
  presentationMode: WorkspacePresentationMode;
}): PaneRenderItem {
  const from = requiredItem(normalItem ?? invisibleItem(overviewItem), paneId);
  const to = requiredItem(overviewItem ?? invisibleItem(normalItem), paneId);
  const target = requiredItem(
    targetItemForMode(presentationMode, normalItem, overviewItem),
    paneId,
  );
  return {
    ...target,
    height: lerp(from.height, to.height, overviewProgress),
    moving: true,
    opacity: lerp(from.opacity, to.opacity, overviewProgress),
    presentationMode,
    resizing: from.resizing || to.resizing,
    scale: lerp(from.scale, to.scale, overviewProgress),
    visible: from.visible || to.visible,
    width: lerp(from.width, to.width, overviewProgress),
    x: lerp(from.x, to.x, overviewProgress),
    y: lerp(from.y, to.y, overviewProgress),
  };
}

function orderedPaneIds(
  normalItems: readonly PaneRenderItem[],
  overviewItems: readonly PaneRenderItem[],
  presentationMode: WorkspacePresentationMode,
  includeSecondaryOnlyItems: boolean,
): PaneId[] {
  const primaryItems =
    presentationMode === "overview" ? overviewItems : normalItems;
  const secondaryItems =
    presentationMode === "overview" ? normalItems : overviewItems;
  const paneIds = new Set<PaneId>();
  for (const item of primaryItems) {
    paneIds.add(item.paneId);
  }
  if (includeSecondaryOnlyItems) {
    for (const item of secondaryItems) {
      paneIds.add(item.paneId);
    }
  }
  return [...paneIds];
}

function invisibleItem(
  item: PaneRenderItem | undefined,
): PaneRenderItem | null {
  return item ? { ...item, opacity: 0, visible: false } : null;
}

function requiredItem(
  item: PaneRenderItem | null | undefined,
  paneId: PaneId,
): PaneRenderItem {
  if (!item) {
    throw new Error(`cannot interpolate missing workspace pane ${paneId}`);
  }
  return item;
}

function targetItemForMode(
  presentationMode: WorkspacePresentationMode,
  normalItem: PaneRenderItem | undefined,
  overviewItem: PaneRenderItem | undefined,
): PaneRenderItem | null {
  return presentationMode === "overview"
    ? (overviewItem ?? normalItem ?? null)
    : (normalItem ?? overviewItem ?? null);
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
