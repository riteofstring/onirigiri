import type { WorkspaceLikeLayoutEngine } from "../layout/layout-engine.js";
import { resizePaneRowAcrossPlane } from "./layout-store-helpers.js";
import { applyPaneSizeTargets } from "../layout/pane-sizing.js";
import type {
  ColumnId,
  ColumnWidthSpec,
  PaneId,
  PaneSizeTarget,
  PaneSizingMode,
  Rect,
  WorkspaceScene,
} from "../types.js";

export type PaneResizeAxis = "column" | "row";
export type PaneResizeFixedEdge = "end" | "start";

interface WorkspaceSizingHooks {
  engine: WorkspaceLikeLayoutEngine;
  focusedColumnId: () => ColumnId | null;
  notify: () => void;
  offsetCamera: (axis: PaneResizeAxis, delta: number) => void;
  paneEndEdge: (paneId: PaneId, axis: PaneResizeAxis) => number | null;
  scene: () => WorkspaceScene;
  updateViewport: (viewport: Rect) => void;
  viewport: () => Rect;
}

export class WorkspaceSizingController {
  constructor(private readonly hooks: WorkspaceSizingHooks) {}

  resetFocusedColumnWidth(): boolean {
    const columnId = this.hooks.focusedColumnId();
    if (!columnId) {
      return false;
    }
    this.hooks.engine.resetColumnWidth(columnId);
    this.hooks.notify();
    return true;
  }

  resizeColumn(columnId: ColumnId, width: ColumnWidthSpec): void {
    this.hooks.engine.resizeColumn(columnId, width);
    this.hooks.notify();
  }

  resizePaneSplit(
    upperPaneId: PaneId,
    lowerPaneId: PaneId,
    upperHeightWeight: number,
    lowerHeightWeight: number,
  ): boolean {
    if (
      !this.hooks.engine.resizePaneSplit(
        upperPaneId,
        lowerPaneId,
        upperHeightWeight,
        lowerHeightWeight,
        this.hooks.viewport(),
      )
    ) {
      return false;
    }
    this.hooks.notify();
    return true;
  }

  resizePanes(
    targets: readonly PaneSizeTarget[],
    viewport: Rect,
    mode?: PaneSizingMode,
  ): void {
    if (!applyPaneSizeTargets(this.hooks.engine, this.hooks.scene(), targets)) {
      return;
    }
    this.hooks.engine.setFullPaneSizing(mode === "full");
    this.hooks.updateViewport(viewport);
    this.hooks.notify();
  }

  resetWorkspaceSizing(viewport: Rect): void {
    this.hooks.engine.resetWorkspaceSizing();
    this.hooks.updateViewport(viewport);
    this.hooks.notify();
  }

  resizePaneRow(
    paneId: PaneId,
    heightPx: number | null,
    fixedEdge: PaneResizeFixedEdge = "start",
  ): boolean {
    const holdEndEdge = this.endEdgeHold(paneId, "row", fixedEdge);
    if (
      !resizePaneRowAcrossPlane(
        this.hooks.engine,
        this.hooks.scene(),
        paneId,
        heightPx,
      )
    ) {
      return false;
    }
    holdEndEdge();
    this.hooks.notify();
    return true;
  }

  resizePaneColumn(
    paneId: PaneId,
    width: ColumnWidthSpec,
    fixedEdge: PaneResizeFixedEdge = "start",
  ): ColumnId | null {
    const columnId = this.hooks.scene().paneById.get(paneId)?.columnId;
    if (!columnId) {
      return null;
    }
    const holdEndEdge = this.endEdgeHold(paneId, "column", fixedEdge);
    this.hooks.engine.resizeColumn(columnId, width);
    holdEndEdge();
    this.hooks.notify();
    return columnId;
  }

  private endEdgeHold(
    paneId: PaneId,
    axis: PaneResizeAxis,
    fixedEdge: PaneResizeFixedEdge,
  ): () => void {
    if (fixedEdge === "start") {
      return () => undefined;
    }
    const before = this.hooks.paneEndEdge(paneId, axis);
    return () => {
      const after = this.hooks.paneEndEdge(paneId, axis);
      if (before !== null && after !== null && after !== before) {
        this.hooks.offsetCamera(axis, after - before);
      }
    };
  }
}
