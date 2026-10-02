import {
  defaultCameraMotion,
  MotionTimeline,
} from "../presentation/motion-curve.js";
import type {
  OnirigiriMotionCurve,
  WorkspaceGridCursorRenderItem,
} from "../types.js";

interface CursorBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface PresentedGridCursorGeometry {
  height: number;
  scale: number;
  width: number;
  x: number;
  y: number;
}

interface CursorBinding {
  host: HTMLElement;
  lastBorderWidth: number;
  lastCellKind: string | null;
  lastHeight: number;
  lastMoving: boolean | null;
  lastPresentationMode: string | null;
  lastScale: number;
  lastTransform: string;
  lastVisible: boolean | null;
  lastWidth: number;
  lastX: number;
  lastY: number;
  motion: { from: CursorBox; fromScale: number } | null;
  motionProgress: number;
}

interface WorkspaceGridCursorPresentationWriteCounts {
  attributeWrites: number;
  boxWrites: number;
  transformWrites: number;
}

export class WorkspaceGridCursorPresentation {
  private binding: CursorBinding | null = null;
  private readonly timeline = new MotionTimeline(defaultCameraMotion.overview);

  bindCursorHost(host: HTMLElement | null): () => void {
    if (this.binding?.host === host) {
      return () => undefined;
    }
    this.binding = host ? createCursorBinding(host) : null;
    return () => {
      if (this.binding?.host === host) {
        this.binding = null;
      }
    };
  }

  apply(
    item: WorkspaceGridCursorRenderItem,
    moving: boolean,
    worldScale = 1,
  ): WorkspaceGridCursorPresentationWriteCounts {
    const binding = this.binding;
    if (!binding) {
      return emptyWriteCounts();
    }
    const counts = emptyWriteCounts();
    const geometry = presentedCursorGeometry(binding, item);
    counts.boxWrites += writeBox(binding, geometry);
    counts.attributeWrites += writeStringAttribute(
      binding,
      "data-cell-kind",
      "lastCellKind",
      item.kind,
    );
    counts.attributeWrites += writeStringAttribute(
      binding,
      "data-presentation-mode",
      "lastPresentationMode",
      item.presentationMode,
    );
    counts.attributeWrites += writeBooleanAttribute(
      binding,
      "data-moving",
      "lastMoving",
      moving,
    );
    counts.attributeWrites += writeBooleanAttribute(
      binding,
      "data-visible",
      "lastVisible",
      true,
    );
    counts.transformWrites += writeTransform(binding, geometry, worldScale);
    return counts;
  }

  retarget(
    item: WorkspaceGridCursorRenderItem,
    curve: OnirigiriMotionCurve = defaultCameraMotion.overview,
  ): boolean {
    const binding = this.binding;
    const from = binding ? displayedCursorBox(binding) : null;
    const to = cursorBoxForItem(item);
    if (!binding || !from || sameCursorBox(from, to)) {
      if (binding) {
        binding.motion = null;
      }
      return false;
    }
    binding.motion = {
      from,
      fromScale: binding.lastScale,
    };
    binding.motionProgress = 0;
    this.timeline.restart(curve);
    return true;
  }

  advanceMotion(deltaMs: number): boolean {
    if (!this.hasActiveMotion()) {
      return false;
    }
    const sample = this.timeline.advance(deltaMs);
    if (this.binding?.motion) {
      this.binding.motionProgress = sample.progress;
    }
    if (sample.done && this.binding) {
      this.binding.motion = null;
      this.binding.motionProgress = 1;
    }
    return this.hasActiveMotion();
  }

  hasActiveMotion(): boolean {
    return this.binding !== null && this.binding.motion !== null;
  }

  snapMotion(): void {
    this.timeline.finish();
    if (this.binding) {
      this.binding.motion = null;
      this.binding.motionProgress = 1;
    }
  }
}

function createCursorBinding(host: HTMLElement): CursorBinding {
  return {
    host,
    lastBorderWidth: Number.NaN,
    lastCellKind: null,
    lastHeight: Number.NaN,
    lastMoving: null,
    lastPresentationMode: null,
    lastScale: Number.NaN,
    lastTransform: "",
    lastVisible: null,
    lastWidth: Number.NaN,
    lastX: Number.NaN,
    lastY: Number.NaN,
    motion: null,
    motionProgress: 1,
  };
}

function presentedCursorGeometry(
  binding: CursorBinding,
  item: WorkspaceGridCursorRenderItem,
): PresentedGridCursorGeometry {
  if (!binding.motion) {
    return cursorGeometryForItem(item);
  }
  const progress = binding.motionProgress;
  const destination = cursorBoxForItem(item);
  const scale = interpolate(
    binding.motion.fromScale,
    normalizedScale(item.scale),
    progress,
  );
  return {
    height:
      interpolate(binding.motion.from.height, destination.height, progress) /
      scale,
    scale,
    width:
      interpolate(binding.motion.from.width, destination.width, progress) /
      scale,
    x: interpolate(binding.motion.from.x, destination.x, progress),
    y: interpolate(binding.motion.from.y, destination.y, progress),
  };
}

function cursorGeometryForItem(
  item: WorkspaceGridCursorRenderItem,
): PresentedGridCursorGeometry {
  return {
    height: item.height,
    scale: normalizedScale(item.scale),
    width: item.width,
    x: item.x,
    y: item.y,
  };
}

function cursorBoxForItem(item: WorkspaceGridCursorRenderItem): CursorBox {
  const scale = normalizedScale(item.scale);
  return {
    height: item.height * scale,
    width: item.width * scale,
    x: item.x,
    y: item.y,
  };
}

function displayedCursorBox(binding: CursorBinding): CursorBox | null {
  if (
    !Number.isFinite(binding.lastHeight) ||
    !Number.isFinite(binding.lastWidth) ||
    !Number.isFinite(binding.lastScale) ||
    !Number.isFinite(binding.lastX) ||
    !Number.isFinite(binding.lastY)
  ) {
    return null;
  }
  return {
    height: binding.lastHeight * binding.lastScale,
    width: binding.lastWidth * binding.lastScale,
    x: binding.lastX,
    y: binding.lastY,
  };
}

function writeBox(
  binding: CursorBinding,
  geometry: PresentedGridCursorGeometry,
): number {
  let writes = 0;
  if (binding.lastWidth !== geometry.width) {
    binding.lastWidth = geometry.width;
    binding.host.style.width = `${geometry.width.toFixed(2)}px`;
    writes += 1;
  }
  if (binding.lastHeight !== geometry.height) {
    binding.lastHeight = geometry.height;
    binding.host.style.height = `${geometry.height.toFixed(2)}px`;
    writes += 1;
  }
  return writes;
}

function writeTransform(
  binding: CursorBinding,
  geometry: PresentedGridCursorGeometry,
  worldScale: number,
): number {
  binding.lastScale = geometry.scale;
  binding.lastX = geometry.x;
  binding.lastY = geometry.y;
  const transform =
    `translate3d(${geometry.x.toFixed(2)}px, ${geometry.y.toFixed(2)}px, 0) ` +
    `scale(${geometry.scale.toFixed(4)})`;
  let writes = 0;
  if (binding.lastTransform !== transform) {
    binding.lastTransform = transform;
    binding.host.style.transform = transform;
    writes += 1;
  }
  const borderWidth = 1 / (geometry.scale * normalizedScale(worldScale));
  if (binding.lastBorderWidth !== borderWidth) {
    binding.lastBorderWidth = borderWidth;
    binding.host.style.borderWidth = `${borderWidth.toFixed(4)}px`;
    writes += 1;
  }
  return writes;
}

function writeStringAttribute(
  binding: CursorBinding,
  attribute: "data-cell-kind" | "data-presentation-mode",
  cacheKey: "lastCellKind" | "lastPresentationMode",
  value: string,
): number {
  if (binding[cacheKey] === value) {
    return 0;
  }
  binding[cacheKey] = value;
  binding.host.setAttribute(attribute, value);
  return 1;
}

function writeBooleanAttribute(
  binding: CursorBinding,
  attribute: "data-moving" | "data-visible",
  cacheKey: "lastMoving" | "lastVisible",
  value: boolean,
): number {
  if (binding[cacheKey] === value) {
    return 0;
  }
  binding[cacheKey] = value;
  binding.host.setAttribute(attribute, String(value));
  return 1;
}

function sameCursorBox(left: CursorBox, right: CursorBox): boolean {
  return (
    Math.abs(left.height - right.height) <= 0.001 &&
    Math.abs(left.width - right.width) <= 0.001 &&
    Math.abs(left.x - right.x) <= 0.001 &&
    Math.abs(left.y - right.y) <= 0.001
  );
}

function normalizedScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function emptyWriteCounts(): WorkspaceGridCursorPresentationWriteCounts {
  return { attributeWrites: 0, boxWrites: 0, transformWrites: 0 };
}
