import type { PaneId, WorkspacePresentationMode } from "../types.js";

export interface WorkspacePresentedPaneGeometry {
  height: number;
  opacity: number;
  paneId: PaneId;
  preload: boolean;
  presentationMode: WorkspacePresentationMode;
  scale: number;
  targetHeight: number;
  targetScale: number;
  targetWidth: number;
  visible: boolean;
  width: number;
  x: number;
  y: number;
  z: number;
}
