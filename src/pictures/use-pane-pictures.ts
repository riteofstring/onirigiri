import { useLayoutEffect, useState } from "react";
import type { OnirigiriRuntime } from "../workspace/onirigiri-workspace-runtime";
import { PanePictures } from "./pane-pictures";
import { workspaceSnapshotIsMoving } from "../presentation/workspace-frame-scheduler";

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
