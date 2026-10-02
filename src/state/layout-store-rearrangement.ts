import type { WorkspaceLikeLayoutEngine } from "../layout/layout-engine";
import type {
  ColumnId,
  PaneId,
  PaneMoveDirection,
  PaneRearrangementSelection,
} from "../types";

interface PaneRearrangementHooks {
  capturePaneRearrangementSource: () => void;
  completePaneRearrangementSource: () => void;
  discardPaneRearrangementSource: () => void;
  engine: WorkspaceLikeLayoutEngine;
  focusedColumnId: () => ColumnId | null;
  focusedPaneId: () => PaneId | null;
  holdCameraPosition: () => void;
  incrementRevision: () => void;
  notify: (layoutChanged?: boolean) => void;
  setCursorForPaneWithoutCamera: (paneId: PaneId) => void;
}

export class PaneRearrangementController {
  private selectedColumnId: ColumnId | null = null;
  private selection: PaneRearrangementSelection = "pane";

  constructor(private readonly hooks: PaneRearrangementHooks) {}

  snapshot(): {
    paneRearrangementSelection: PaneRearrangementSelection;
    selectedGroupColumnId: ColumnId | null;
  } {
    return {
      paneRearrangementSelection: this.selection,
      selectedGroupColumnId: this.selectedColumnId,
    };
  }

  clear(): boolean {
    if (this.selection !== "group") {
      return false;
    }
    this.clearWithoutNotify();
    this.hooks.notify(false);
    return true;
  }

  clearWithoutNotify(): void {
    this.selection = "pane";
    this.selectedColumnId = null;
  }

  select(): boolean {
    const columnId = this.hooks.focusedColumnId();
    if (!columnId) {
      return false;
    }
    if (this.selection === "group" && this.selectedColumnId === columnId) {
      return false;
    }
    this.selection = "group";
    this.selectedColumnId = columnId;
    this.hooks.notify(false);
    return true;
  }

  move(direction: PaneMoveDirection): boolean {
    if (this.selection !== "group") {
      return false;
    }
    const paneId = this.hooks.focusedPaneId();
    if (!paneId) {
      return false;
    }
    this.hooks.capturePaneRearrangementSource();
    if (!this.hooks.engine.movePaneGroup(paneId, direction)) {
      this.hooks.discardPaneRearrangementSource();
      return false;
    }
    this.hooks.completePaneRearrangementSource();
    this.hooks.holdCameraPosition();
    this.hooks.setCursorForPaneWithoutCamera(paneId);
    this.selectedColumnId = this.hooks.focusedColumnId();
    this.hooks.incrementRevision();
    this.hooks.notify();
    return true;
  }

  insert(direction: "left" | "right"): boolean {
    const paneId = this.hooks.focusedPaneId();
    if (!paneId) {
      return false;
    }
    this.hooks.capturePaneRearrangementSource();
    if (!this.hooks.engine.insertPaneAsSplit(paneId, direction)) {
      this.hooks.discardPaneRearrangementSource();
      return false;
    }
    this.hooks.completePaneRearrangementSource();
    this.hooks.holdCameraPosition();
    this.hooks.setCursorForPaneWithoutCamera(paneId);
    this.clearWithoutNotify();
    this.hooks.incrementRevision();
    this.hooks.notify();
    return true;
  }

  createBlank(direction: "up" | "down"): boolean {
    const paneId = this.hooks.focusedPaneId();
    if (
      !paneId ||
      !this.hooks.engine.createReservedBlankSplit(paneId, direction)
    ) {
      return false;
    }
    this.clearWithoutNotify();
    this.hooks.notify();
    return true;
  }

  removeBlank(direction: "up" | "down"): boolean {
    const paneId = this.hooks.focusedPaneId();
    if (
      !paneId ||
      !this.hooks.engine.removeReservedBlankSplit(paneId, direction)
    ) {
      return false;
    }
    this.clearWithoutNotify();
    this.hooks.notify();
    return true;
  }
}
