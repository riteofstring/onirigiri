import { useRef } from "react";

import { WorkspaceLikeLayoutEngine } from "../layout/layout-engine";
import { WorkspaceLayoutStore } from "../state/layout-store";
import type { OnirigiriWorkspaceProps } from "./onirigiri-workspace-types";
import { PanePresentationEngine } from "../presentation/pane-presentation-engine";
import { createWorkspaceScene } from "./workspace-scene";
import { WorkspaceGridCursorPresentation } from "./workspace-grid-cursor-presentation";
import { WorkspaceWorldPresentation } from "../presentation/workspace-world-presentation";
import { WorkspaceMinimapPresentation } from "../presentation/workspace-minimap-presentation";

export interface OnirigiriRuntime {
  cursorPresentation: WorkspaceGridCursorPresentation;
  engine: WorkspaceLikeLayoutEngine;
  minimapPresentation: WorkspaceMinimapPresentation;
  presentation: PanePresentationEngine;
  store: WorkspaceLayoutStore;
  worldPresentation: WorkspaceWorldPresentation;
}

interface OnirigiriRuntimeOptions extends Pick<
  OnirigiriWorkspaceProps,
  "paneDefaults" | "paneTypeDefaults"
> {
  allowResizedPanesToOverflowViewport: boolean;
  cameraModes: NonNullable<OnirigiriWorkspaceProps["cameraModes"]>;
  cursorRunway: OnirigiriWorkspaceProps["cursorRunway"];
  focusAnchor: NonNullable<OnirigiriWorkspaceProps["focusAnchor"]>;
  gridAxes: NonNullable<OnirigiriWorkspaceProps["gridAxes"]>;
  initialLayout: OnirigiriWorkspaceProps["initialLayout"];
  initialPanes: NonNullable<OnirigiriWorkspaceProps["initialPanes"]>;
  overviewCardMaxWidthPx: number | undefined;
  overviewCardMinWidthPx: number | undefined;
  paneLimits: OnirigiriWorkspaceProps["paneLimits"];
  workspaceId: string;
}

export function useOnirigiriRuntime(
  options: OnirigiriRuntimeOptions,
): OnirigiriRuntime {
  const runtimeRef = useRef<OnirigiriRuntime | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createOnirigiriRuntime(options);
  }
  return runtimeRef.current;
}

function createOnirigiriRuntime({
  allowResizedPanesToOverflowViewport,
  cameraModes,
  cursorRunway,
  focusAnchor,
  gridAxes,
  initialLayout,
  initialPanes,
  overviewCardMaxWidthPx,
  overviewCardMinWidthPx,
  paneLimits,
  paneDefaults,
  paneTypeDefaults,
  workspaceId,
}: OnirigiriRuntimeOptions): OnirigiriRuntime {
  const { cursor, scene } = createWorkspaceScene({
    gridAxes,
    id: workspaceId,
    initialLayout,
    panes: initialPanes,
    paneDefaults,
    paneTypeDefaults,
  });
  const engine = new WorkspaceLikeLayoutEngine(scene, {
    allowResizedPanesToOverflowViewport,
    overviewCardMaxWidthPx,
    overviewCardMinWidthPx,
  });
  return {
    cursorPresentation: new WorkspaceGridCursorPresentation(),
    engine,
    minimapPresentation: new WorkspaceMinimapPresentation(),
    presentation: new PanePresentationEngine(),
    store: new WorkspaceLayoutStore(engine, scene, cursor, {
      cursorRunway,
      initialCameraModes: cameraModes,
      initialFocusAnchor: focusAnchor,
      paneLimits,
    }),
    worldPresentation: new WorkspaceWorldPresentation(),
  };
}
