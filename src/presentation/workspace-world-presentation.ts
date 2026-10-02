import type {
  OnirigiriMotionCurve,
  Rect,
  WorkspaceWorldFrame,
} from "../types.js";
import { defaultCameraMotion, MotionTimeline } from "./motion-curve.js";
import { unionRects } from "./workspace-sweep-geometry.js";

const worldGridOverscanRatio = 0.25;

interface WorldTransform {
  scale: number;
  x: number;
  y: number;
}

interface WorldMotion {
  focalWorldX: number;
  focalWorldY: number;
  from: WorldTransform;
  fromFocalScreenX: number;
  fromFocalScreenY: number;
  to: WorldTransform;
  toFocalScreenX: number;
  toFocalScreenY: number;
}

interface WorldBinding {
  grid: HTMLElement;
  host: HTMLElement;
  lastGridHeight: number;
  lastGridLeft: number;
  lastGridTop: number;
  lastGridWidth: number;
  lastGridPosition: string;
  lastTransform: string;
  lastWillChange: string;
  motion: WorldMotion | null;
  motionGrid: Rect | null;
  motionProgress: number;
  presentedFrame: WorkspaceWorldFrame | null;
  recenterGrid: boolean;
}

export class WorkspaceWorldPresentation {
  private binding: WorldBinding | null = null;
  private readonly timeline = new MotionTimeline(defaultCameraMotion.overview);

  bindWorldHost(
    host: HTMLElement | null,
    grid: HTMLElement | null,
  ): () => void {
    if (this.binding?.host === host && this.binding.grid === grid) {
      return () => undefined;
    }
    this.binding = host && grid ? createWorldBinding(host, grid) : null;
    return () => {
      if (this.binding?.host === host && this.binding.grid === grid) {
        this.binding = null;
      }
    };
  }

  apply(frame: WorkspaceWorldFrame, moving = false): WorkspaceWorldFrame {
    const binding = this.binding;
    if (!binding) {
      return frame;
    }
    const presented = this.present(frame);
    const transform = frameTransform(presented);
    const transformValue = worldTransform(transform);
    if (binding.lastTransform !== transformValue) {
      binding.lastTransform = transformValue;
      binding.host.style.transform = transformValue;
    }
    const willChange = moving || binding.motion ? "transform" : "";
    if (binding.lastWillChange !== willChange) {
      binding.lastWillChange = willChange;
      binding.host.style.willChange = willChange;
    }
    writeWorldGrid(binding, frame);
    return presented;
  }

  present(frame: WorkspaceWorldFrame): WorkspaceWorldFrame {
    const binding = this.binding;
    if (!binding) {
      return frame;
    }
    binding.presentedFrame = frame;
    const transform = presentedTransform(binding, frame);
    const viewport = projectedRect(frame.grid, frameTransform(frame));
    return {
      ...frame,
      ...transform,
      grid: unionRects(frame.grid, inverseProjectedRect(viewport, transform)),
    };
  }

  retarget(
    from: WorkspaceWorldFrame,
    to: WorkspaceWorldFrame,
    curve: OnirigiriMotionCurve = defaultCameraMotion.overview,
  ): boolean {
    const binding = this.binding;
    if (!binding) {
      return false;
    }
    const current = binding.presentedFrame
      ? presentedTransform(binding, binding.presentedFrame)
      : frameTransform(from);
    const target = frameTransform(to);
    if (sameTransform(current, target)) {
      binding.motion = null;
      binding.motionGrid = null;
      binding.motionProgress = 1;
      binding.recenterGrid = true;
      this.timeline.finish();
      this.apply(to);
      return false;
    }
    const motion = worldMotion(current, target, to);
    binding.motion = motion;
    binding.motionGrid = worldMotionGrid(current, from, to);
    binding.motionProgress = 0;
    binding.presentedFrame = to;
    binding.recenterGrid = true;
    this.timeline.restart(curve);
    this.apply(to, true);
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
      this.binding.motionGrid = null;
      this.binding.motionProgress = 1;
      this.binding.recenterGrid = true;
    }
    return this.hasActiveMotion();
  }

  hasActiveMotion(): boolean {
    return this.binding !== null && this.binding.motion !== null;
  }

  presentedScale(fallback = 1): number {
    const binding = this.binding;
    return binding?.presentedFrame
      ? presentedTransform(binding, binding.presentedFrame).scale
      : normalizedScale(fallback);
  }

  activeMotionGrid(): Rect | null {
    return this.binding?.motionGrid ?? null;
  }

  snapMotion(): void {
    this.timeline.finish();
    if (!this.binding) {
      return;
    }
    this.binding.motion = null;
    this.binding.motionGrid = null;
    this.binding.motionProgress = 1;
    this.binding.recenterGrid = true;
    if (this.binding.presentedFrame) {
      this.apply(this.binding.presentedFrame);
    }
  }
}

function createWorldBinding(
  host: HTMLElement,
  grid: HTMLElement,
): WorldBinding {
  return {
    grid,
    host,
    lastGridHeight: Number.NaN,
    lastGridLeft: Number.NaN,
    lastGridPosition: "",
    lastGridTop: Number.NaN,
    lastGridWidth: Number.NaN,
    lastTransform: "",
    lastWillChange: "",
    motion: null,
    motionGrid: null,
    motionProgress: 1,
    presentedFrame: null,
    recenterGrid: true,
  };
}

function presentedTransform(
  binding: WorldBinding,
  frame: WorkspaceWorldFrame,
): WorldTransform {
  return binding.motion
    ? interpolatedWorldMotion(binding.motion, binding.motionProgress)
    : frameTransform(frame);
}

function interpolatedWorldMotion(
  motion: WorldMotion,
  progress: number,
): WorldTransform {
  const eased = progress;
  const scale = interpolate(motion.from.scale, motion.to.scale, eased);
  const focalScreenX = interpolate(
    motion.fromFocalScreenX,
    motion.toFocalScreenX,
    eased,
  );
  const focalScreenY = interpolate(
    motion.fromFocalScreenY,
    motion.toFocalScreenY,
    eased,
  );
  return {
    scale,
    x: focalScreenX - scale * motion.focalWorldX,
    y: focalScreenY - scale * motion.focalWorldY,
  };
}

function worldMotion(
  from: WorldTransform,
  to: WorldTransform,
  frame: WorkspaceWorldFrame,
): WorldMotion {
  const focalWorldX = finiteCoordinate(frame.focalWorldX);
  const focalWorldY = finiteCoordinate(frame.focalWorldY);
  return {
    focalWorldX,
    focalWorldY,
    from,
    fromFocalScreenX: from.x + from.scale * focalWorldX,
    fromFocalScreenY: from.y + from.scale * focalWorldY,
    to,
    toFocalScreenX: finiteCoordinate(frame.focalScreenX),
    toFocalScreenY: finiteCoordinate(frame.focalScreenY),
  };
}

function worldMotionGrid(
  current: WorldTransform,
  from: WorkspaceWorldFrame,
  to: WorkspaceWorldFrame,
): Rect {
  const viewport = projectedRect(to.grid, frameTransform(to));
  return unionRects(
    unionRects(from.grid, to.grid),
    inverseProjectedRect(viewport, current),
  );
}

function projectedRect(rect: Rect, transform: WorldTransform): Rect {
  return {
    height: rect.height * transform.scale,
    width: rect.width * transform.scale,
    x: transform.x + rect.x * transform.scale,
    y: transform.y + rect.y * transform.scale,
  };
}

function inverseProjectedRect(rect: Rect, transform: WorldTransform): Rect {
  return {
    height: rect.height / transform.scale,
    width: rect.width / transform.scale,
    x: (rect.x - transform.x) / transform.scale,
    y: (rect.y - transform.y) / transform.scale,
  };
}

function frameTransform(frame: WorkspaceWorldFrame): WorldTransform {
  return {
    scale: normalizedScale(frame.scale),
    x: finiteCoordinate(frame.x),
    y: finiteCoordinate(frame.y),
  };
}

function writeWorldGrid(
  binding: WorldBinding,
  frame: WorkspaceWorldFrame,
): void {
  const requiredGrid = binding.motionGrid ?? frame.grid;
  if (
    !binding.recenterGrid &&
    !worldGridNeedsRecentering(binding, requiredGrid)
  ) {
    return;
  }
  binding.recenterGrid = false;
  const grid = paddedRect(requiredGrid);
  const left = grid.x;
  const top = grid.y;
  const width = grid.width;
  const height = grid.height;
  if (binding.lastGridLeft !== left) {
    binding.lastGridLeft = left;
    binding.grid.style.left = `${left.toFixed(2)}px`;
  }
  if (binding.lastGridTop !== top) {
    binding.lastGridTop = top;
    binding.grid.style.top = `${top.toFixed(2)}px`;
  }
  if (binding.lastGridWidth !== width) {
    binding.lastGridWidth = width;
    binding.grid.style.width = `${width.toFixed(2)}px`;
  }
  if (binding.lastGridHeight !== height) {
    binding.lastGridHeight = height;
    binding.grid.style.height = `${height.toFixed(2)}px`;
  }
  const position = `${(-left).toFixed(2)}px ${(-top).toFixed(2)}px`;
  if (binding.lastGridPosition !== position) {
    binding.lastGridPosition = position;
    binding.grid.style.setProperty(
      "--world-grid-phase-x",
      `${(-left).toFixed(2)}px`,
    );
    binding.grid.style.setProperty(
      "--world-grid-phase-y",
      `${(-top).toFixed(2)}px`,
    );
  }
}

function worldGridNeedsRecentering(
  binding: WorldBinding,
  requiredGrid: Rect,
): boolean {
  if (
    !Number.isFinite(binding.lastGridLeft) ||
    !Number.isFinite(binding.lastGridTop) ||
    !Number.isFinite(binding.lastGridWidth) ||
    !Number.isFinite(binding.lastGridHeight)
  ) {
    return true;
  }
  const required = normalizedRect(requiredGrid);
  return (
    required.x < binding.lastGridLeft ||
    required.y < binding.lastGridTop ||
    required.x + required.width >
      binding.lastGridLeft + binding.lastGridWidth ||
    required.y + required.height > binding.lastGridTop + binding.lastGridHeight
  );
}

function paddedRect(rect: Rect): Rect {
  const normalized = normalizedRect(rect);
  const horizontalOverscan = normalized.width * worldGridOverscanRatio;
  const verticalOverscan = normalized.height * worldGridOverscanRatio;
  return {
    height: normalized.height + 2 * verticalOverscan,
    width: normalized.width + 2 * horizontalOverscan,
    x: normalized.x - horizontalOverscan,
    y: normalized.y - verticalOverscan,
  };
}

function normalizedRect(rect: Rect): Rect {
  return {
    height: Math.max(1, finiteCoordinate(rect.height)),
    width: Math.max(1, finiteCoordinate(rect.width)),
    x: finiteCoordinate(rect.x),
    y: finiteCoordinate(rect.y),
  };
}

function worldTransform({ scale, x, y }: WorldTransform): string {
  return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
}

function sameTransform(left: WorldTransform, right: WorldTransform): boolean {
  return (
    Math.abs(left.scale - right.scale) <= 0.001 &&
    Math.abs(left.x - right.x) <= 0.001 &&
    Math.abs(left.y - right.y) <= 0.001
  );
}

function normalizedScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
