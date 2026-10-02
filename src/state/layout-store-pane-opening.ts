import type { WorkspaceLikeLayoutEngine } from "../layout/layout-engine.js";
import { workspacePaneLimitState } from "./layout-store-helpers.js";
import type { WorkspacePaneLimitState } from "./layout-store-types.js";
import type {
  ColumnId,
  OpenPaneRequest,
  PaneId,
  PaneInsertionPlacement,
  PaneLimitPolicy,
  SurfaceKind,
  WorkspaceScene,
} from "../types.js";

interface PaneOpeningHooks {
  commitPane: (paneId: PaneId) => void;
  currentColumnId: () => ColumnId | undefined;
  engine: WorkspaceLikeLayoutEngine;
  paneLimits: PaneLimitPolicy | undefined;
  scene: () => WorkspaceScene;
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
    this.hooks.commitPane(paneId);
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
    this.hooks.commitPane(createdPaneId);
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
    const createdPaneId = this.hooks.engine.splitPane(paneId, direction);
    this.hooks.commitPane(createdPaneId);
    return createdPaneId;
  }

  splitToPlane(paneId: PaneId, direction: "up" | "down"): PaneId {
    this.assertKnownPane(paneId);
    const createdPaneId = this.hooks.engine.splitPaneToPlane(paneId, direction);
    this.hooks.commitPane(createdPaneId);
    return createdPaneId;
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
