import type { PaneId, WorkspacePane } from "../types.js";

export interface OnirigiriPanePicture {
  image: Blob;
  fit?: "contain" | "cover" | "fill";
  position?: string;
}

export type OnirigiriPanePictureResolver = (
  pane: WorkspacePane,
) => OnirigiriPanePicture | null | undefined;

export interface OnirigiriPaneCaptureReceipt {
  id: string;
  devicePixelRatio: number;
  pixelsPerCss: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
}

export interface OnirigiriCaptureStatus {
  state: "unconfigured" | "idle" | "capturing" | "unavailable";
  reason: string | null;
  pictureBytes: number;
  pictureRasterBytes: number;
  overviewPaneId: PaneId | null;
  preloadingPaneId: PaneId | null;
  pictures: readonly {
    paneId: PaneId;
    revision: number;
    capture: OnirigiriPaneCaptureReceipt | null;
    width: number;
    height: number;
    pixelated: boolean;
  }[];
  inFlightPaneIds: readonly PaneId[];
  accepted: number;
  rejected: number;
  invalidated: number;
}
