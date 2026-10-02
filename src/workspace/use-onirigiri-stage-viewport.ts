import {
  useLayoutEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import type { WorkspaceLayoutSnapshot } from "../state/layout-store.js";
import type { OnirigiriRuntime } from "./onirigiri-workspace-runtime.js";
import type { Rect } from "../types.js";
import type { WorkspaceFrameScheduler } from "../presentation/workspace-frame-scheduler.js";

interface OnirigiriStageViewportOptions {
  compactBreakpoint: number;
  compactPanePeek: number;
  runtime: OnirigiriRuntime;
  schedulerRef: RefObject<WorkspaceFrameScheduler | null>;
  setLayoutSnapshot: Dispatch<SetStateAction<WorkspaceLayoutSnapshot>>;
  setViewport: Dispatch<SetStateAction<Rect>>;
  stageRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<Rect>;
}

export function useOnirigiriStageViewport(
  options: OnirigiriStageViewportOptions,
): void {
  const {
    compactBreakpoint,
    compactPanePeek,
    runtime,
    schedulerRef,
    setLayoutSnapshot,
    setViewport,
    stageRef,
    viewportRef,
  } = options;
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const syncSize = (width: number, height: number) => {
      const viewport = {
        height: Math.max(1, height),
        width: Math.max(1, width),
        x: 0,
        y: 0,
      };
      viewportRef.current = viewport;
      runtime.engine.setCompactLayout(
        viewport.width <= compactBreakpoint,
        compactPanePeek,
      );
      runtime.store.ensureFocusedPaneVisible(viewport);
      runtime.presentation.presentWorkspace(
        runtime.store.getSnapshot(),
        viewport,
      );
      setViewport(viewport);
      setLayoutSnapshot(runtime.store.getSnapshot());
      schedulerRef.current?.requestFrame();
    };
    const bounds = stage.getBoundingClientRect();
    syncSize(bounds.width, bounds.height);
    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (size) {
        syncSize(size.width, size.height);
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [
    compactBreakpoint,
    compactPanePeek,
    runtime,
    schedulerRef,
    setLayoutSnapshot,
    setViewport,
    stageRef,
    viewportRef,
  ]);
}
