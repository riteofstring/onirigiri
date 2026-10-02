import type {
  PanePresentation,
  PanePresentationResolver,
  PanePresentationState,
} from "../presentation/pane-presentation-policy";
import type {
  OnirigiriCaptureStatus,
  OnirigiriPanePictureResolver,
} from "./pane-picture-types";
import type { PaneId, PaneRenderItem, WorkspacePane } from "../types";

export interface Configuration {
  panes: ReadonlyMap<PaneId, WorkspacePane>;
  items: readonly PaneRenderItem[];
  resolver?: OnirigiriPanePictureResolver;
  presentation?: PanePresentation;
  getPresentation?: PanePresentationResolver;
  liveContent?: boolean;
  budgetBytes: number;
  rasterBudgetBytes?: number;
  minLongEdgePx?: number;
  captureMissingOverviewPictures?: boolean;
  preloadMarginPanes?: number;
  preloadAllPanePictures?: boolean;
  onPresentationChange?: (paneId: PaneId, state: PanePresentationState) => void;
  onStatus?: (status: OnirigiriCaptureStatus) => void;
}

export type ResolvedConfiguration = Configuration & {
  rasterBudgetBytes: number;
  minLongEdgePx: number;
};

export function resolveConfiguration(
  configuration: Configuration,
): ResolvedConfiguration {
  const margin = configuration.preloadMarginPanes ?? 0;
  if (!Number.isInteger(margin) || margin < 0)
    throw new Error("Invalid preload margin");
  const raster = configuration.rasterBudgetBytes ?? 256 * 1024 * 1024;
  const minEdge = configuration.minLongEdgePx ?? 128;
  if (
    ![configuration.budgetBytes, raster].every(
      (bytes) => Number.isFinite(bytes) && bytes >= 0,
    )
  )
    throw new Error("Invalid picture budget");
  if (!Number.isInteger(minEdge) || minEdge < 1)
    throw new Error("Invalid minimum picture resolution");
  return {
    ...configuration,
    rasterBudgetBytes: raster,
    minLongEdgePx: minEdge,
  };
}

export function acquisitionChanged(
  next: Configuration,
  previous: Configuration,
): boolean {
  return (
    [
      "budgetBytes",
      "rasterBudgetBytes",
      "minLongEdgePx",
      "captureMissingOverviewPictures",
      "preloadMarginPanes",
      "preloadAllPanePictures",
      "liveContent",
    ] as const
  ).some((key) => next[key] !== previous[key]);
}

export function samePictureSurface(
  left: WorkspacePane,
  right: WorkspacePane,
): boolean {
  return (
    left.surfaceId === right.surfaceId && left.surfaceKind === right.surfaceKind
  );
}
