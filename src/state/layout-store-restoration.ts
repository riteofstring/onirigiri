import type { WorkspaceScene } from "../types.js";
import {
  createWorkspaceScene,
  type OnirigiriLayout,
  type WorkspaceSceneResult,
} from "../workspace/workspace-scene.js";

export function restoredWorkspaceScene(
  scene: WorkspaceScene,
  layout: OnirigiriLayout,
): WorkspaceSceneResult {
  return createWorkspaceScene({
    columnGap: scene.columnGap,
    defaultColumnWidth: scene.defaultColumnWidthSpec,
    gridAxes: scene.gridAxes,
    id: scene.id,
    initialLayout: layout,
    padding: scene.padding,
    paneDefaults: scene.paneDefaults,
    paneTypeDefaults: scene.paneTypeDefaults,
    renderOverscanColumns: scene.renderOverscanColumns,
    rowGap: scene.rowGap,
    visibleColumnCount: scene.visibleColumnCount,
  });
}
