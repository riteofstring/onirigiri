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
  abovePaneIdByPaneId: ReadonlyMap<PaneId, PaneId>;
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
  restPictureFade?: boolean;
  rowHeightByPaneId: ReadonlyMap<PaneId, number>;
  selectedGroupColumnId: string | null;
  showControls: boolean;
  store: WorkspaceLayoutStore;
}

export function OnirigiriWorkspacePaneLayer({
  abovePaneIdByPaneId,
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
  restPictureFade,
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
    const neighbour = (paneId: PaneId | undefined) => ({
      item: paneId ? (renderItemByPaneId.get(paneId) ?? null) : null,
      pane: paneId ? (paneById.get(paneId) ?? null) : null,
    });
    const adjacent = neighbour(adjacentPaneIdByPaneId.get(item.paneId));
    const above = neighbour(abovePaneIdByPaneId.get(item.paneId));
    return (
      <OnirigiriPaneView
        aboveItem={above.item}
        abovePane={above.pane}
        adjacentItem={adjacent.item}
        adjacentPane={adjacent.pane}
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
        restPictureFade={restPictureFade}
        rowHeight={rowHeightByPaneId.get(pane.paneId) ?? item.height}
        showControls={showControls}
        store={store}
      />
    );
  });
}
