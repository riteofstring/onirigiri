import type {
  OnirigiriMinimapCorner,
  OnirigiriMinimapPlacement,
} from "../workspace/onirigiri-workspace-types";

export const defaultMinimapPlacement: OnirigiriMinimapPlacement = {
  corner: "bottom-right",
  heightPx: 140,
  widthPx: 200,
};

export const minimapMinimumSize = { heightPx: 64, widthPx: 96 };
export const minimapDragThresholdPx = 4;

const minimapCorners: readonly OnirigiriMinimapCorner[] = [
  "bottom-left",
  "bottom-right",
  "top-left",
  "top-right",
];

interface Size {
  height: number;
  width: number;
}

interface Point {
  x: number;
  y: number;
}

export function resolveMinimapPlacement(
  placement: Partial<OnirigiriMinimapPlacement> | undefined,
): OnirigiriMinimapPlacement {
  return {
    corner:
      placement?.corner && minimapCorners.includes(placement.corner)
        ? placement.corner
        : defaultMinimapPlacement.corner,
    heightPx: minimapDimension(
      placement?.heightPx,
      defaultMinimapPlacement.heightPx,
      minimapMinimumSize.heightPx,
    ),
    widthPx: minimapDimension(
      placement?.widthPx,
      defaultMinimapPlacement.widthPx,
      minimapMinimumSize.widthPx,
    ),
  };
}

export function nearestMinimapCorner(
  center: Point,
  stage: Size,
): OnirigiriMinimapCorner {
  const vertical = center.y < stage.height / 2 ? "top" : "bottom";
  const horizontal = center.x < stage.width / 2 ? "left" : "right";
  return `${vertical}-${horizontal}`;
}

export function resizedMinimapPlacement(
  start: OnirigiriMinimapPlacement,
  delta: Point,
  limit: Size,
): OnirigiriMinimapPlacement {
  const growsRight = start.corner.endsWith("left");
  const growsDown = start.corner.startsWith("top");
  return {
    corner: start.corner,
    heightPx: clamp(
      Math.round(start.heightPx + (growsDown ? delta.y : -delta.y)),
      minimapMinimumSize.heightPx,
      Math.max(minimapMinimumSize.heightPx, limit.height),
    ),
    widthPx: clamp(
      Math.round(start.widthPx + (growsRight ? delta.x : -delta.x)),
      minimapMinimumSize.widthPx,
      Math.max(minimapMinimumSize.widthPx, limit.width),
    ),
  };
}

export function sameMinimapPlacement(
  left: OnirigiriMinimapPlacement,
  right: OnirigiriMinimapPlacement,
): boolean {
  return (
    left.corner === right.corner &&
    left.heightPx === right.heightPx &&
    left.widthPx === right.widthPx
  );
}

function minimapDimension(
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(minimum, Math.round(value))
    : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
