import type { PaneRenderItem, PaneWorldBox } from "../types.js";

interface PaneBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface PresentedPaneGeometry {
  height: number;
  scale: number;
  width: number;
  x: number;
  y: number;
}

export interface PaneRearrangement {
  from: PaneBox;
  fromScale: number;
}

interface PaneGeometryBinding {
  lastHeight: number;
  lastTransformScale: number;
  lastTransformX: number;
  lastTransformY: number;
  lastWidth: number;
  paneRearrangement: PaneRearrangement | null;
  paneRearrangementProgress: number;
}

export function storedPaneTransform(
  binding: PaneGeometryBinding,
): string | null {
  if (!hasFiniteTransformCoordinates(binding)) {
    return null;
  }
  const translation = storedPaneTranslation(binding);
  return `${translation} ${storedPaneScale(binding)}`;
}

export function hasFiniteTransformCoordinates(
  binding: PaneGeometryBinding,
): boolean {
  return (
    Number.isFinite(binding.lastTransformX) &&
    Number.isFinite(binding.lastTransformY) &&
    Number.isFinite(binding.lastTransformScale)
  );
}

export function displayedPaneBox(binding: PaneGeometryBinding): PaneBox | null {
  if (!hasFiniteTransformCoordinates(binding)) {
    return null;
  }
  return {
    height: binding.lastHeight * binding.lastTransformScale,
    width: binding.lastWidth * binding.lastTransformScale,
    x: binding.lastTransformX,
    y: binding.lastTransformY,
  };
}

export function presentedPaneGeometry(
  binding: PaneGeometryBinding,
  item: PaneRenderItem,
): PresentedPaneGeometry {
  const motion = binding.paneRearrangement;
  return motion
    ? interpolatedPaneGeometry(motion, binding.paneRearrangementProgress, item)
    : presentedPaneGeometryWithoutBinding(item);
}

export function interpolatedPaneGeometry(
  motion: PaneRearrangement,
  motionProgress: number,
  item: PaneRenderItem,
): PresentedPaneGeometry {
  const progress = easedPaneRearrangementProgress(motionProgress);
  const destination = paneBoxForItem(item);
  const scale = interpolate(motion.fromScale, item.scale, progress);
  const visualWidth = interpolate(
    motion.from.width,
    destination.width,
    progress,
  );
  const visualHeight = interpolate(
    motion.from.height,
    destination.height,
    progress,
  );
  return {
    height: visualHeight / scale,
    scale,
    width: visualWidth / scale,
    x: interpolate(motion.from.x, destination.x, progress),
    y: interpolate(motion.from.y, destination.y, progress),
  };
}

export function presentedPaneGeometryWithoutBinding(
  item: PaneRenderItem,
): PresentedPaneGeometry {
  return {
    height: item.height,
    scale: item.scale,
    width: item.width,
    x: item.x,
    y: item.y,
  };
}

export function paneBoxForItem(item: PaneWorldBox): PaneBox {
  const scale = normalizedPaneScale(item.scale);
  return {
    height: item.height * scale,
    width: item.width * scale,
    x: item.x,
    y: item.y,
  };
}

export function samePaneBox(left: PaneBox, right: PaneBox): boolean {
  return (
    Math.abs(left.height - right.height) <= 0.001 &&
    Math.abs(left.width - right.width) <= 0.001 &&
    Math.abs(left.x - right.x) <= 0.001 &&
    Math.abs(left.y - right.y) <= 0.001
  );
}

export function normalizedPaneScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function easedPaneRearrangementProgress(progress: number): number {
  return 1 - (1 - progress) * (1 - progress);
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function storedPaneTranslation(binding: PaneGeometryBinding): string {
  return `translate(${binding.lastTransformX.toFixed(2)}px, ${binding.lastTransformY.toFixed(2)}px)`;
}

function storedPaneScale(binding: PaneGeometryBinding): string {
  return `scale(${binding.lastTransformScale.toFixed(4)})`;
}
