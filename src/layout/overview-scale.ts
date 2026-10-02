import type { Rect } from "../types";

export const OVERVIEW_MAX_ZOOM_SCALE = 0.5;
export const OVERVIEW_MIN_ZOOM = 0.2;

const maximumOverviewScale = 0.42;
const minimumOverviewScale = 0.12;

export interface OverviewCardSizeConstraints {
  maxWidthPx?: number;
  minWidthPx?: number;
}

interface OverviewScaleInput {
  cardSizeConstraints?: OverviewCardSizeConstraints;
  height: number;
  padding: number;
  referenceCardWidth?: number;
  viewport: Rect;
  width: number;
}

export function overviewScale({
  cardSizeConstraints = {},
  height,
  padding,
  referenceCardWidth = 0,
  viewport,
  width,
}: OverviewScaleInput): number {
  const fitWidth = (viewport.width - padding * 2) / Math.max(1, width);
  const fitHeight = (viewport.height - padding * 2) / Math.max(1, height);
  const fitScale = Math.min(fitWidth, fitHeight);
  if (!hasOverviewCardSizeConstraint(cardSizeConstraints)) {
    return clampScale(
      Math.min(fitScale, maximumOverviewScale),
      minimumOverviewScale,
      1,
    );
  }
  const scaleBounds = overviewCardScaleBounds(
    referenceCardWidth,
    cardSizeConstraints,
  );
  return clampScale(fitScale, scaleBounds.minScale, scaleBounds.maxScale);
}

export function applyOverviewZoom(
  fitScale: number,
  zoom: number | undefined,
): number {
  const normalizedZoom =
    typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const ceiling = Math.max(fitScale, OVERVIEW_MAX_ZOOM_SCALE);
  return clampScale(
    fitScale * normalizedZoom,
    fitScale * OVERVIEW_MIN_ZOOM,
    ceiling,
  );
}

function hasOverviewCardSizeConstraint({
  maxWidthPx,
  minWidthPx,
}: OverviewCardSizeConstraints): boolean {
  return (
    isPositiveFiniteNumber(minWidthPx) || isPositiveFiniteNumber(maxWidthPx)
  );
}

function overviewCardScaleBounds(
  referenceCardWidth: number,
  { maxWidthPx, minWidthPx }: OverviewCardSizeConstraints,
): { maxScale: number; minScale: number } {
  const normalizedReferenceWidth = Math.max(1, referenceCardWidth);
  const minScale = isPositiveFiniteNumber(minWidthPx)
    ? minWidthPx / normalizedReferenceWidth
    : minimumOverviewScale;
  const maxScale = isPositiveFiniteNumber(maxWidthPx)
    ? maxWidthPx / normalizedReferenceWidth
    : 1;
  return {
    maxScale: Math.min(1, Math.max(minScale, maxScale)),
    minScale: Math.min(1, Math.min(minScale, maxScale)),
  };
}

function isPositiveFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampScale(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
