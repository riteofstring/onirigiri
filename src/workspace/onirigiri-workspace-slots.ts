import type { CSSProperties } from "react";

import {
  resolveOnirigiriSlotProps,
  type OnirigiriStylingOptions,
} from "../styles/onirigiri-styling";

interface OnirigiriWorkspaceSlotProps {
  className: string;
  style: CSSProperties | undefined;
}

interface OnirigiriWorkspaceSlots {
  cursorSlot: OnirigiriWorkspaceSlotProps;
  stageSlot: OnirigiriWorkspaceSlotProps;
  statusSlot: OnirigiriWorkspaceSlotProps;
  workspaceSlot: OnirigiriWorkspaceSlotProps;
}

export function resolveOnirigiriWorkspaceSlots(
  styling: OnirigiriStylingOptions,
): OnirigiriWorkspaceSlots {
  return {
    cursorSlot: resolveOnirigiriSlotProps(
      styling,
      "grid-cursor",
      "onirigiri-workspace__grid-cursor",
    ),
    stageSlot: resolveOnirigiriSlotProps(
      styling,
      "stage",
      "onirigiri-workspace__stage",
    ),
    statusSlot: resolveOnirigiriSlotProps(
      styling,
      "status",
      "onirigiri-workspace__status",
    ),
    workspaceSlot: resolveOnirigiriSlotProps(
      styling,
      "workspace",
      "onirigiri-workspace",
    ),
  };
}
