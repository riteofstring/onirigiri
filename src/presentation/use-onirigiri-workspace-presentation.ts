import { useLayoutEffect, type Dispatch, type SetStateAction } from "react";

import type { WorkspaceLayoutSnapshot } from "../state/layout-store";
import type { OnirigiriRuntime } from "../workspace/onirigiri-workspace-runtime";
import type { PanePictures } from "../pictures/pane-pictures";
import type { Rect } from "../types";
import {
  WorkspaceFrameScheduler,
  type WorkspaceFrameMotionOptions,
  type WorkspacePresentationBoundaryFrame,
} from "./workspace-frame-scheduler";

interface OnirigiriWorkspacePresentationOptions {
  boundaryFrameRef: {
    current: WorkspacePresentationBoundaryFrame | null;
  };
  compactBreakpoint: number;
  cursorRef: { current: HTMLDivElement | null };
  focusHighlightEnabled: boolean;
  motionRef: { current: WorkspaceFrameMotionOptions };
  runtime: OnirigiriRuntime;
  pictures: PanePictures;
  schedulerRef: { current: WorkspaceFrameScheduler | null };
  setLayoutSnapshot: Dispatch<SetStateAction<WorkspaceLayoutSnapshot>>;
  setPresentationMoving: Dispatch<SetStateAction<boolean>>;
  viewportRef: { current: Rect };
  workspaceRef: { current: HTMLDivElement | null };
  worldGridRef: { current: HTMLDivElement | null };
  worldRef: { current: HTMLDivElement | null };
}

interface WorkspaceBoundaryPublisherOptions {
  boundaryFrameRef: {
    current: WorkspacePresentationBoundaryFrame | null;
  };
  runtime: OnirigiriRuntime;
  setLayoutSnapshot: Dispatch<SetStateAction<WorkspaceLayoutSnapshot>>;
  setPresentationMoving: Dispatch<SetStateAction<boolean>>;
}

class WorkspaceBoundaryPublisher {
  constructor(private readonly options: WorkspaceBoundaryPublisherOptions) {}

  publish(
    snapshot: WorkspaceLayoutSnapshot,
    boundary: "request" | "settle",
    frame: WorkspacePresentationBoundaryFrame | null,
  ): void {
    this.commit(snapshot, boundary, frame);
  }

  private commit(
    snapshot: WorkspaceLayoutSnapshot,
    boundary: "request" | "settle",
    frame: WorkspacePresentationBoundaryFrame | null,
  ): void {
    const {
      boundaryFrameRef,
      runtime,
      setLayoutSnapshot,
      setPresentationMoving,
    } = this.options;
    boundaryFrameRef.current = frame;
    setLayoutSnapshot(snapshot);
    setPresentationMoving(
      boundary === "request" &&
        (runtime.presentation.hasActivePaneRearrangement() ||
          runtime.worldPresentation.hasActiveMotion()),
    );
  }
}

export function useOnirigiriWorkspacePresentation(
  options: OnirigiriWorkspacePresentationOptions,
): void {
  const {
    boundaryFrameRef,
    compactBreakpoint,
    cursorRef,
    focusHighlightEnabled,
    motionRef,
    runtime,
    pictures,
    schedulerRef,
    setLayoutSnapshot,
    setPresentationMoving,
    viewportRef,
    workspaceRef,
    worldGridRef,
    worldRef,
  } = options;
  useLayoutEffect(
    () =>
      runtime.cursorPresentation.bindCursorHost(
        focusHighlightEnabled ? cursorRef.current : null,
      ),
    [cursorRef, focusHighlightEnabled, runtime],
  );

  useLayoutEffect(
    () =>
      runtime.worldPresentation.bindWorldHost(
        worldRef.current,
        worldGridRef.current,
      ),
    [runtime, worldGridRef, worldRef],
  );

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }
    const ownerWindow = workspace.ownerDocument.defaultView;
    const reducedMotionQuery = ownerWindow?.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );
    runtime.presentation.bindWorkspace(workspace);
    runtime.presentation.presentWorkspace(
      runtime.store.getSnapshot(),
      viewportRef.current,
    );
    let scheduler: WorkspaceFrameScheduler | null = null;
    const boundaryPublisher = new WorkspaceBoundaryPublisher({
      boundaryFrameRef,
      runtime,
      setLayoutSnapshot,
      setPresentationMoving,
    });
    scheduler = new WorkspaceFrameScheduler({
      compactLayoutProvider: () =>
        viewportRef.current.width <= compactBreakpoint,
      cursorPresentation: runtime.cursorPresentation,
      engine: runtime.engine,
      frameHost: ownerWindow ?? undefined,
      minimapPresentation: runtime.minimapPresentation,
      motionProvider: () => motionRef.current,
      onBoundary: (snapshot, boundary, frame) =>
        boundaryPublisher.publish(snapshot, boundary, frame),
      onPresentation: pictures.present,
      presentation: runtime.presentation,
      reducedMotionQuery,
      store: runtime.store,
      viewportProvider: () => viewportRef.current,
      worldPresentation: runtime.worldPresentation,
    });
    schedulerRef.current = scheduler;
    scheduler.start();
    return () => {
      if (schedulerRef.current === scheduler) {
        schedulerRef.current = null;
      }
      scheduler.teardown();
      runtime.presentation.bindWorkspace(null);
    };
  }, [
    boundaryFrameRef,
    compactBreakpoint,
    motionRef,
    runtime,
    pictures,
    schedulerRef,
    setLayoutSnapshot,
    setPresentationMoving,
    viewportRef,
    workspaceRef,
  ]);
}
