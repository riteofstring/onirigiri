import type {
  OnirigiriPaneCaptureReceipt,
  OnirigiriPanePicture,
} from "./pane-picture-types";
import type { PanePictureTexture } from "./pane-picture-texture";
import {
  orderPaneActivation,
  paneActivationDistance,
} from "./pane-picture-activation";
import type { ResolvedConfiguration } from "./pane-picture-configuration";
import type { PaneId, PaneRenderItem } from "../types";

interface PictureSize {
  width: number;
  height: number;
}

export interface CachedPanePicture extends PictureSize {
  revision: number;
  capture: OnirigiriPaneCaptureReceipt | null;
  image: Blob;
  originalSize: PictureSize;
  texture: PanePictureTexture;
  preview: PanePictureTexture;
  fit: "contain" | "cover" | "fill";
  position: string;
  pixelated: boolean;
}

interface PictureAcceptance {
  revision: number;
  capture?: OnirigiriPaneCaptureReceipt;
  evict?: boolean;
}

type PrepareTexture = (
  image: Blob,
  size: PictureSize,
  valid: () => boolean,
) => Promise<PanePictureTexture>;

export class PanePictureCache {
  private readonly pictures = new Map<PaneId, CachedPanePicture>();
  private readonly blocked = new Set<PaneId>();
  private readonly previewOnly = new Set<PaneId>();
  private priority: readonly PaneId[] = [];
  private desired = new Set<PaneId>();
  private protectedIds = new Set<PaneId>();
  private budgetBytes = 0;
  private rasterBudgetBytes = 0;
  private minLongEdgePx = 128;
  private planKey = "";
  bytes = 0;
  rasterBytes = 0;

  constructor(
    private readonly prepare: PrepareTexture,
    private readonly changed: (id: PaneId) => void,
  ) {}

  get = (id: PaneId): CachedPanePicture | null => this.pictures.get(id) ?? null;
  has = (id: PaneId): boolean => this.pictures.has(id);
  keys = (): MapIterator<PaneId> => this.pictures.keys();
  [Symbol.iterator](): MapIterator<[PaneId, CachedPanePicture]> {
    return this.pictures.entries();
  }

  configure(
    configuration: ResolvedConfiguration,
    focused: PaneId | null,
  ): void {
    this.budgetBytes = configuration.budgetBytes;
    this.rasterBudgetBytes = configuration.rasterBudgetBytes;
    this.minLongEdgePx = configuration.minLongEdgePx;
    const ordered = orderPaneActivation(configuration.items, focused);
    this.priority = ordered.map((item) => item.paneId);
    this.protectedIds = new Set(
      ordered.filter(normalVisible).map((item) => item.paneId),
    );
    this.desired = new Set(
      ordered
        .filter(
          (item) =>
            normalVisible(item) || paneActivationDistance(item, ordered[0]) < 2,
        )
        .map((item) => item.paneId),
    );
    const key = JSON.stringify([
      this.budgetBytes,
      this.rasterBudgetBytes,
      [...this.desired],
      this.priority,
    ]);
    if (key !== this.planKey) this.blocked.clear();
    this.planKey = key;
  }

  style(id: PaneId, fit: CachedPanePicture["fit"], position: string): void {
    const picture = this.get(id);
    if (!picture || (picture.fit === fit && picture.position === position))
      return;
    this.pictures.set(id, { ...picture, fit, position });
    this.changed(id);
  }

  setDetail(id: PaneId, detail: "full" | "preview"): void {
    if (detail === "preview") {
      this.previewOnly.add(id);
      this.demote(id, true);
    } else this.previewOnly.delete(id);
  }

  async accept(
    id: PaneId,
    source: OnirigiriPanePicture,
    size: PictureSize,
    valid: () => boolean,
    options: PictureAcceptance,
  ): Promise<boolean> {
    const previewSize = reducedSize(size, this.minLongEdgePx);
    if (
      !valid() ||
      !this.makeRoom(
        source.image.size,
        rasterSize(previewSize),
        id,
        options.evict ?? true,
      )
    )
      return false;
    const previous = this.get(id);
    const current = () => valid() && this.get(id) === previous;
    let preview: PanePictureTexture;
    try {
      preview = await this.prepare(source.image, previewSize, current);
    } catch {
      return false;
    }
    if (
      !current() ||
      !this.withinBudget(source.image.size, rasterSize(preview))
    ) {
      preview.dispose();
      return false;
    }
    this.commitPicture(id, source, size, preview, options);
    await this.restoreOne(id, valid);
    return true;
  }

  private commitPicture(
    id: PaneId,
    source: OnirigiriPanePicture,
    size: PictureSize,
    preview: PanePictureTexture,
    options: PictureAcceptance,
  ): void {
    this.release(id, false);
    this.pictures.set(id, {
      revision: options.revision,
      capture: options.capture ?? null,
      image: source.image,
      originalSize: size,
      preview,
      texture: preview,
      width: preview.width,
      height: preview.height,
      pixelated: preview.width !== size.width || preview.height !== size.height,
      fit: source.fit ?? "contain",
      position: source.position ?? "center",
    });
    this.bytes += source.image.size;
    this.rasterBytes += rasterSize(preview);
    this.blocked.delete(id);
    this.changed(id);
  }

  async reconcile(valid: () => boolean): Promise<void> {
    this.makeRoom(0, 0, undefined, true);
    for (const id of this.priority) {
      if (!valid()) return;
      if (await this.restoreOne(id, valid)) return;
    }
  }

  private async restoreOne(id: PaneId, valid: () => boolean): Promise<boolean> {
    const picture = this.get(id);
    if (
      !picture?.pixelated ||
      !this.desired.has(id) ||
      this.blocked.has(id) ||
      this.previewOnly.has(id)
    )
      return false;
    const bytes = rasterSize(picture.originalSize);
    if (!this.makeRoom(0, bytes, id, false)) {
      this.blocked.add(id);
      return false;
    }
    const current = () =>
      valid() &&
      this.get(id) === picture &&
      this.desired.has(id) &&
      !this.previewOnly.has(id);
    try {
      const texture = await this.prepare(
        picture.image,
        picture.originalSize,
        current,
      );
      return this.commitDetail(id, picture, texture, current);
    } catch {
      if (current()) this.blocked.add(id);
      return false;
    }
  }

  private commitDetail(
    id: PaneId,
    picture: CachedPanePicture,
    texture: PanePictureTexture,
    current: () => boolean,
  ): boolean {
    const bytes = rasterSize(texture);
    if (!current() || !this.withinBudget(0, bytes)) {
      texture.dispose();
      return false;
    }
    this.pictures.set(id, {
      ...picture,
      ...picture.originalSize,
      texture,
      pixelated: false,
    });
    this.rasterBytes += bytes;
    this.changed(id);
    return true;
  }

  private withinBudget(encoded: number, raster: number): boolean {
    return (
      this.bytes + encoded <= this.budgetBytes &&
      this.rasterBytes + raster <= this.rasterBudgetBytes
    );
  }

  private candidates(replacement: PaneId | undefined): PaneId[] {
    return [...this.pictures.keys()]
      .filter((id) => id !== replacement && !this.protectedIds.has(id))
      .sort((a, b) => this.rank(b) - this.rank(a));
  }

  private rank(id: PaneId): number {
    const index = this.priority.indexOf(id);
    return index === -1 ? Infinity : index;
  }

  private canMakeRoom(
    encoded: number,
    raster: number,
    replacement: PaneId | undefined,
    evict: boolean,
    candidates: readonly PaneId[],
  ): boolean {
    if (this.withinBudget(encoded, raster)) return true;
    const removable = candidates.reduce(
      (sum, id) => {
        const picture = this.get(id)!;
        const detail =
          picture.texture !== picture.preview &&
          (evict || !replacement || this.rank(id) >= this.rank(replacement));
        return {
          encoded: sum.encoded + (evict ? picture.image.size : 0),
          raster:
            sum.raster +
            (evict ? rasterSize(picture.preview) : 0) +
            (detail ? rasterSize(picture.texture) : 0),
        };
      },
      { encoded: 0, raster: 0 },
    );
    return this.withinBudget(
      encoded - removable.encoded,
      raster - removable.raster,
    );
  }

  private makeRoom(
    encoded: number,
    raster: number,
    replacement: PaneId | undefined,
    evict: boolean,
  ): boolean {
    const candidates = this.candidates(replacement);
    if (!this.canMakeRoom(encoded, raster, replacement, evict, candidates))
      return false;
    for (const id of candidates) {
      if (this.withinBudget(encoded, raster)) return true;
      if (replacement && this.rank(id) < this.rank(replacement)) continue;
      this.demote(id);
    }
    if (evict) {
      for (const id of candidates) {
        if (this.withinBudget(encoded, raster)) return true;
        this.release(id);
      }
    }
    return this.withinBudget(encoded, raster);
  }

  private demote(id: PaneId, force = false): void {
    const picture = this.get(id);
    if (
      !picture ||
      picture.texture === picture.preview ||
      (!force && this.protectedIds.has(id))
    )
      return;
    this.pictures.set(id, {
      ...picture,
      width: picture.preview.width,
      height: picture.preview.height,
      texture: picture.preview,
      pixelated: true,
    });
    this.rasterBytes -= rasterSize(picture.texture);
    picture.texture.dispose();
    this.blocked.clear();
    this.changed(id);
  }

  release(id: PaneId, emit = true): void {
    const picture = this.get(id);
    if (!picture) return;
    this.pictures.delete(id);
    this.bytes -= picture.image.size;
    this.rasterBytes -= rasterSize(picture.preview);
    if (picture.texture !== picture.preview) {
      this.rasterBytes -= rasterSize(picture.texture);
      picture.texture.dispose();
    }
    picture.preview.dispose();
    this.blocked.clear();
    if (emit) this.changed(id);
  }
}

function rasterSize(size: PictureSize): number {
  return size.width * size.height * 4;
}

function reducedSize(size: PictureSize, edge: number): PictureSize {
  const scale = Math.min(1, edge / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale)),
  };
}

function normalVisible(item: PaneRenderItem): boolean {
  return item.visible && item.presentationMode === "normal";
}
