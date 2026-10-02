import { useLayoutEffect, useState } from "react";
import type { OnirigiriRuntime } from "../workspace/onirigiri-workspace-runtime.js";
import { PanePictures } from "./pane-pictures.js";
import { workspaceSnapshotIsMoving } from "../presentation/workspace-frame-scheduler.js";

export function usePanePictures(
  runtime: OnirigiriRuntime,
  workspace: { current: HTMLDivElement | null },
): PanePictures {
  const [pictures] = useState(
    () =>
      new PanePictures(
        () =>
          workspaceSnapshotIsMoving(runtime.store.getSnapshot()) ||
          runtime.presentation.hasActivePaneRearrangement() ||
          runtime.worldPresentation.hasActiveMotion(),
        () => runtime.store.getSnapshot().focusedPaneId,
        () => runtime.store.getSnapshot().presentationMode === "overview",
      ),
  );
  useLayoutEffect(() => {
    if (!workspace.current) return;
    const stop = pictures.start(workspace.current);
    const unsubscribe = runtime.store.subscribe(pictures.activity);
    return () => {
      unsubscribe();
      stop();
    };
  }, [pictures, runtime, workspace]);
  return pictures;
}
