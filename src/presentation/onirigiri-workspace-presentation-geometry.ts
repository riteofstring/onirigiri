import type { WorkspaceLayoutSnapshot } from "../state/layout-store";
import type {
  PaneId,
  PaneRenderItem,
  WorkspacePane,
  WorkspaceScene,
  WorkspaceWorldFrame,
} from "../types";
import type { WorkspacePresentationBoundaryFrame } from "./workspace-frame-scheduler";
import type {
  WorkspaceRenderItemsInput,
  WorkspaceWorldFrameRenderer,
} from "./workspace-render-items";

export function compactPanePeekIsEnabled(
  compactLayout: boolean,
  compactPanePeek: number,
): boolean {
  return (
    compactLayout && Number.isFinite(compactPanePeek) && compactPanePeek > 0
  );
}

export function motionContentTargetWorldFrame(
  input: WorkspaceRenderItemsInput,
  worldFrameRenderer: WorkspaceWorldFrameRenderer,
): WorkspaceWorldFrame | undefined {
  if (!input.moving) {
    return undefined;
  }
  const { snapshot } = input;
  return worldFrameRenderer.render({
    ...input,
    snapshot: {
      ...snapshot,
      horizontalAnchorOffset: snapshot.targetHorizontalAnchorOffset,
      overviewProgress: snapshot.presentationMode === "overview" ? 1 : 0,
      scrollColumn: snapshot.targetScrollColumn,
      scrollRow: snapshot.targetScrollRow,
      verticalAnchorOffset: snapshot.targetVerticalAnchorOffset,
    },
  });
}

export function matchingBoundaryFrame(
  frame: WorkspacePresentationBoundaryFrame | null,
  snapshot: WorkspaceLayoutSnapshot,
): WorkspacePresentationBoundaryFrame | null {
  return frame?.snapshot === snapshot ? frame : null;
}

export function selectedPaneGroupColumnId(
  snapshot: WorkspaceLayoutSnapshot,
): string | null {
  return snapshot.paneRearrangementSelection === "group"
    ? snapshot.selectedGroupColumnId
    : null;
}

export function paneRowHeights(
  mountedRenderItems: readonly PaneRenderItem[],
  paneById: ReadonlyMap<PaneId, WorkspacePane>,
  columnById: ReadonlyMap<string, WorkspaceScene["columns"][number]>,
  renderItemByPaneId: ReadonlyMap<PaneId, PaneRenderItem>,
  rowGap: number,
): Map<PaneId, number> {
  const result = new Map<PaneId, number>();
  const mountedPaneIds = new Set(mountedRenderItems.map((item) => item.paneId));
  const mountedColumnIds = new Set(
    mountedRenderItems.flatMap((item) => {
      const columnId = paneById.get(item.paneId)?.columnId;
      return columnId ? [columnId] : [];
    }),
  );
  for (const columnId of mountedColumnIds) {
    const column = columnById.get(columnId);
    if (!column) {
      continue;
    }
    const columnItems = column.cells
      .flatMap((cell) =>
        cell.paneId ? [renderItemByPaneId.get(cell.paneId)] : [],
      )
      .filter((item): item is PaneRenderItem => item !== undefined);
    const rowHeight =
      columnItems.reduce((height, item) => height + item.height, 0) +
      Math.max(0, columnItems.length - 1) * rowGap;
    for (const { paneId } of column.cells) {
      if (paneId && mountedPaneIds.has(paneId)) {
        result.set(paneId, rowHeight);
      }
    }
  }
  return result;
}
