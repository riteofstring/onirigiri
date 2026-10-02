import type { OnirigiriWorkspaceProps } from "./onirigiri-workspace-types";
import {
  defaultWorkspaceCameraModes,
  defaultWorkspaceGridAxes,
} from "../types";

type DefaultedOnirigiriWorkspaceProp =
  | "allowResizedPanesToOverflowViewport"
  | "ariaLabel"
  | "cameraModes"
  | "compactBreakpoint"
  | "compactPanePeek"
  | "directionControlMode"
  | "focusAnchor"
  | "gridAxes"
  | "initialLayout"
  | "initialPanes"
  | "minimapAdjustable"
  | "pictureBudgetBytes"
  | "pictureRasterBudgetBytes"
  | "pictureMinLongEdgePx"
  | "captureMissingOverviewPictures"
  | "retainedAreaBudgetViewports"
  | "preloadMarginPanes"
  | "shortcutScope"
  | "showControls"
  | "showMinimap"
  | "showOverviewControl"
  | "workspaceId";

const defaults: Required<
  Pick<OnirigiriWorkspaceProps, DefaultedOnirigiriWorkspaceProp>
> = {
  allowResizedPanesToOverflowViewport: false,
  ariaLabel: "Onirigiri workspace",
  cameraModes: defaultWorkspaceCameraModes,
  compactBreakpoint: 640,
  compactPanePeek: 0,
  directionControlMode: "focus",
  focusAnchor: "center",
  gridAxes: defaultWorkspaceGridAxes,
  initialLayout: null,
  initialPanes: [],
  minimapAdjustable: true,
  pictureBudgetBytes: 256 * 1024 * 1024,
  pictureRasterBudgetBytes: 256 * 1024 * 1024,
  pictureMinLongEdgePx: 128,
  captureMissingOverviewPictures: false,
  retainedAreaBudgetViewports: 8,
  preloadMarginPanes: 1,
  shortcutScope: "workspace",
  showControls: true,
  showMinimap: false,
  showOverviewControl: true,
  workspaceId: "onirigiri-workspace",
};

type ResolvedOnirigiriWorkspaceProps = Omit<
  OnirigiriWorkspaceProps,
  DefaultedOnirigiriWorkspaceProp
> &
  typeof defaults;

export function resolveOnirigiriWorkspaceProps(
  props: OnirigiriWorkspaceProps,
): ResolvedOnirigiriWorkspaceProps {
  return {
    ...props,
    ...withDefinedOverrides(defaults, props),
  };
}

function withDefinedOverrides<T extends object>(
  defaultValues: T,
  overrides: { [K in keyof T]?: T[K] | undefined },
): T {
  const resolved = { ...defaultValues };
  for (const key in defaultValues) {
    const value = overrides[key];
    if (value !== undefined) {
      resolved[key] = value;
    }
  }
  return resolved;
}
