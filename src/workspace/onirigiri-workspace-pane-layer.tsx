import type { WorkspaceLayoutStore } from "../state/layout-store.js";
import {
  OnirigiriPaneView,
  type OnirigiriPaneViewProps,
} from "../panes/onirigiri-pane-view.js";
import type { PanePresentationEngine } from "../presentation/pane-presentation-engine.js";
import type { PanePictures } from "../pictures/pane-pictures.js";
import type { PaneResizeStart } from "../input/pane-resize-interactions.js";
import type { OnirigiriWorkspaceProps } from "./onirigiri-workspace-types.js";
import type { PaneId, PaneRenderItem, WorkspacePane } from "../types.js";

interface OnirigiriWorkspacePaneLayerProps {
  adjacentPaneIdByPaneId: ReadonlyMap<PaneId, PaneId>;
  beginResize: PaneResizeStart;
  closePane: OnirigiriPaneViewProps["closePane"];
  compactLayout: boolean;
  pictures: PanePictures;
  mountedRenderItems: readonly PaneRenderItem[];
  paneById: ReadonlyMap<PaneId, WorkspacePane>;
  presentation: PanePresentationEngine;
  renderItemByPaneId: ReadonlyMap<PaneId, PaneRenderItem>;
  renderPane: OnirigiriWorkspaceProps["renderPane"];
  renderPanePlaceholder?: OnirigiriWorkspaceProps["renderPanePlaceholder"];
  rowHeightByPaneId: ReadonlyMap<PaneId, number>;
  selectedGroupColumnId: string | null;
  showControls: boolean;
  store: WorkspaceLayoutStore;
}

export function OnirigiriWorkspacePaneLayer({
  adjacentPaneIdByPaneId,
  beginResize,
  closePane,
  compactLayout,
  pictures,
  mountedRenderItems,
  paneById,
  presentation,
  renderItemByPaneId,
  renderPane,
  renderPanePlaceholder,
  rowHeightByPaneId,
  selectedGroupColumnId,
  showControls,
  store,
}: OnirigiriWorkspacePaneLayerProps) {
  const mountedById = new Map(
    mountedRenderItems.map((item) => [item.paneId, item]),
  );
  return [...paneById.values()].map((pane) => {
    const item = mountedById.get(pane.paneId);
    if (!item) {
      return null;
    }
    const adjacentPaneId = adjacentPaneIdByPaneId.get(item.paneId);
    const adjacentPane = adjacentPaneId
      ? (paneById.get(adjacentPaneId) ?? null)
      : null;
    const adjacentItem = adjacentPaneId
      ? (renderItemByPaneId.get(adjacentPaneId) ?? null)
      : null;
    return (
      <OnirigiriPaneView
        adjacentItem={adjacentItem}
        adjacentPane={adjacentPane}
        beginResize={beginResize}
        closePane={closePane}
        compactLayout={compactLayout}
        pictures={pictures}
        groupSelected={selectedGroupColumnId === pane.columnId}
        item={item}
        key={pane.paneId}
        pane={pane}
        presentation={presentation}
        renderPane={renderPane}
        renderPanePlaceholder={renderPanePlaceholder}
        rowHeight={rowHeightByPaneId.get(pane.paneId) ?? item.height}
        showControls={showControls}
        store={store}
      />
    );
  });
}
