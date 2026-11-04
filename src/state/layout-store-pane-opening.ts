import type { WorkspaceLikeLayoutEngine } from "../layout/layout-engine.js";
import { workspacePaneLimitState } from "./layout-store-helpers.js";
import type { WorkspacePaneLimitState } from "./layout-store-types.js";
import type {
  ColumnId,
  OpenPaneRequest,
  PaneId,
  PaneInsertionPlacement,
  PaneLimitPolicy,
  Rect,
  SurfaceKind,
  WorkspaceScene,
} from "../types.js";

interface PaneOpeningHooks {
  commitPane: (paneId: PaneId) => void;
  currentColumnId: () => ColumnId | undefined;
  engine: WorkspaceLikeLayoutEngine;
  paneLimits: PaneLimitPolicy | undefined;
  scene: () => WorkspaceScene;
  viewport: () => Rect;
}

export class WorkspacePaneOpeningController {
  constructor(private readonly hooks: PaneOpeningHooks) {}

  open(request: OpenPaneRequest): PaneId {
    this.assertPaneAllowed(request);
    const columnId = request.columnId;
    const paneId = this.hooks.engine.openPane({
      ...request,
      adjacentToColumnId: columnId ? undefined : this.hooks.currentColumnId(),
      columnId,
    });
    this.commit(paneId);
    return paneId;
  }

  openNear(
    paneId: PaneId,
    placement: PaneInsertionPlacement,
    request: OpenPaneRequest,
  ): PaneId {
    this.assertKnownPane(paneId);
    this.assertPaneAllowed(request);
    const createdPaneId = this.hooks.engine.openPaneNearPane(
      paneId,
      placement,
      request,
    );
    this.commit(createdPaneId);
    return createdPaneId;
  }

  configure(paneId: PaneId, request: OpenPaneRequest): PaneId {
    const limitState = this.limitState(request);
    if (
      !limitState.allowed &&
      !this.configureKeepsSurfaceKind(paneId, request)
    ) {
      throw paneLimitError(limitState.surfaceKind);
    }
    const configuredPaneId = this.hooks.engine.configurePane(paneId, request);
    this.hooks.commitPane(configuredPaneId);
    return configuredPaneId;
  }

  limitState(request: { surfaceKind?: SurfaceKind }): WorkspacePaneLimitState {
    return workspacePaneLimitState(
      this.hooks.scene(),
      this.hooks.paneLimits,
      request,
    );
  }

  split(paneId: PaneId, direction: "up" | "down" | "left" | "right"): PaneId {
    this.assertKnownPane(paneId);
    const createdPaneId = this.hooks.engine.splitPane(
      paneId,
      direction,
      this.hooks.viewport(),
    );
    this.commit(createdPaneId);
    return createdPaneId;
  }

  splitToPlane(paneId: PaneId, direction: "up" | "down"): PaneId {
    this.assertKnownPane(paneId);
    const createdPaneId = this.hooks.engine.splitPaneToPlane(paneId, direction);
    this.commit(createdPaneId);
    return createdPaneId;
  }

  private commit(paneId: PaneId): void {
    this.matchRowHeight(paneId);
    this.hooks.commitPane(paneId);
  }

  private matchRowHeight(paneId: PaneId): void {
    const scene = this.hooks.scene();
    const columnId = scene.paneById.get(paneId)?.columnId;
    const column = scene.columns.find((entry) => entry.columnId === columnId);
    if (column?.cells.length !== 1 || column.cells[0]!.heightPx !== undefined)
      return;
    const reference = scene.columns.find(
      (entry) =>
        entry !== column &&
        entry.planeIndex === column.planeIndex &&
        entry.cells.length > 0 &&
        entry.cells.every((cell) => cell.heightPx !== undefined),
    );
    if (!reference) return;
    const height =
      reference.cells.reduce((sum, cell) => sum + cell.heightPx!, 0) +
      scene.rowGap * (reference.cells.length - 1);
    this.hooks.engine.resizeColumnRows(column.columnId, [height]);
  }

  private assertKnownPane(paneId: PaneId): void {
    if (!this.hooks.engine.paneLocation(paneId)) {
      throw new Error(`unknown workspace pane ${paneId}`);
    }
  }

  private assertPaneAllowed(request: OpenPaneRequest): void {
    const limitState = this.limitState(request);
    if (!limitState.allowed) {
      throw paneLimitError(limitState.surfaceKind);
    }
  }

  private configureKeepsSurfaceKind(
    paneId: PaneId,
    request: OpenPaneRequest,
  ): boolean {
    const currentSurfaceKind = this.hooks
      .scene()
      .paneById.get(paneId)?.surfaceKind;
    return Boolean(
      currentSurfaceKind &&
      (request.surfaceKind ?? currentSurfaceKind) === currentSurfaceKind,
    );
  }
}

function paneLimitError(surfaceKind: SurfaceKind | null): Error {
  return new Error(
    `workspace pane limit reached for ${surfaceKind ?? "requested surface"}`,
  );
}
