import { worldPaneRenderer } from "./workspace-sweep-geometry";
import type {
  LayoutEngine,
  PaneId,
  PaneRenderItem,
  PaneWorldBox,
  WorkspacePane,
  WorkspaceScene,
} from "../types";
import {
  workspaceMotionSceneIsCacheable,
  workspaceMotionSceneKey,
  workspaceGeometryOrigin,
  type WorkspaceRenderItemsInput,
} from "./workspace-render-items";

interface WorkspaceMotionSceneCache {
  engine: LayoutEngine;
  itemKey: string | null;
  items: PaneRenderItem[];
  key: string;
  scene: WorkspaceScene;
  worldBoxes: readonly PaneWorldBox[];
}

interface WorkspaceMotionSceneResolution {
  items: PaneRenderItem[];
  key: string;
  paneById: ReadonlyMap<PaneId, WorkspacePane>;
}

export class WorkspaceMotionSceneInventory {
  private cache: WorkspaceMotionSceneCache | null = null;

  cachedItemKey(input: WorkspaceRenderItemsInput): string | null {
    if (!workspaceMotionSceneIsCacheable(input)) {
      return null;
    }
    const key = workspaceMotionSceneKey(input);
    const itemKey = workspaceMotionItemKey(input);
    return this.cache?.engine === input.engine &&
      this.cache.key === key &&
      this.cache.itemKey === itemKey
      ? itemKey
      : null;
  }

  resolve(
    input: WorkspaceRenderItemsInput,
    renderedItems: readonly PaneRenderItem[],
    worldBoxes?: readonly PaneWorldBox[],
    force = false,
  ): WorkspaceMotionSceneResolution {
    if (!workspaceMotionSceneIsCacheable(input)) {
      this.cache = null;
    }
    const key = workspaceMotionSceneKey(input);
    if (this.cache?.engine !== input.engine || this.cache.key !== key) {
      this.cache = {
        engine: input.engine,
        itemKey: null,
        items: [],
        key,
        scene: input.engine.toScene(),
        worldBoxes:
          worldBoxes ??
          input.engine.paneWorldBoxes(
            input.viewport,
            input.snapshot.maximizedPaneId,
            workspaceGeometryOrigin(input),
          ),
      };
    }
    const itemKey = workspaceMotionItemKey(input);
    if (force || this.cache.itemKey !== itemKey) {
      this.cache.itemKey = itemKey;
      this.cache.items = motionSceneItems(
        input,
        renderedItems,
        this.cache.scene,
        this.cache.worldBoxes,
      );
    }
    return {
      items: this.cache.items,
      key: itemKey,
      paneById: this.cache.scene.paneById,
    };
  }
}

export function workspaceMotionSceneItems(
  input: WorkspaceRenderItemsInput,
  renderedItems: readonly PaneRenderItem[],
): PaneRenderItem[] {
  const scene = input.engine.toScene();
  return motionSceneItems(
    input,
    renderedItems,
    scene,
    input.engine.paneWorldBoxes(
      input.viewport,
      input.snapshot.maximizedPaneId,
      workspaceGeometryOrigin(input),
    ),
  );
}

function motionSceneItems(
  input: WorkspaceRenderItemsInput,
  renderedItems: readonly PaneRenderItem[],
  scene: WorkspaceScene,
  worldBoxes: readonly PaneWorldBox[],
): PaneRenderItem[] {
  const renderedByPaneId = new Map(
    renderedItems.map((item) => [item.paneId, item]),
  );
  const render = worldPaneRenderer(scene, input.snapshot);
  return worldBoxes.flatMap((box) => {
    const existing = renderedByPaneId.get(box.paneId);
    const item = existing ?? render(box);
    if (!item) {
      return [];
    }
    return [
      {
        ...item,
        ...box,
        opacity:
          input.snapshot.maximizedPaneId === null || item.maximized ? 1 : 0,
        preload: existing?.preload === true,
        presentationMode: input.snapshot.presentationMode,
        visible: true,
      },
    ];
  });
}

function workspaceMotionItemKey(input: WorkspaceRenderItemsInput): string {
  return [
    workspaceMotionSceneKey(input),
    input.snapshot.paneRearrangementRevision,
  ].join(":");
}
