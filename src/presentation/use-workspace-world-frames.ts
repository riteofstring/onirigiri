import { useMemo } from "react";

import type { WorkspaceLayoutSnapshot } from "../state/layout-store.js";
import { motionContentTargetWorldFrame } from "./onirigiri-workspace-presentation-geometry.js";
import type { LayoutEngine, Rect, WorkspaceWorldFrame } from "../types.js";
import type { WorkspaceWorldFrameRenderer } from "./workspace-render-items.js";

interface WorkspaceWorldFramesOptions {
  compactLayout: boolean;
  engine: LayoutEngine;
  layoutSnapshot: WorkspaceLayoutSnapshot;
  moving: boolean;
  viewport: Rect;
  worldFrameRenderer: WorkspaceWorldFrameRenderer;
}

interface WorkspaceWorldFrames {
  mountContentDuringMotion: boolean;
  targetWorldFrame: WorkspaceWorldFrame | undefined;
}

export function useWorkspaceWorldFrames(
  options: WorkspaceWorldFramesOptions,
): WorkspaceWorldFrames {
  const {
    compactLayout,
    engine,
    layoutSnapshot,
    moving,
    viewport,
    worldFrameRenderer,
  } = options;
  return useMemo(() => {
    const input = {
      compactLayout,
      engine,
      moving,
      snapshot: layoutSnapshot,
      viewport,
    };
    return {
      mountContentDuringMotion: layoutSnapshot.presentationMode === "normal",
      targetWorldFrame: motionContentTargetWorldFrame(
        input,
        worldFrameRenderer,
      ),
    };
  }, [
    compactLayout,
    engine,
    layoutSnapshot,
    moving,
    viewport,
    worldFrameRenderer,
  ]);
}
