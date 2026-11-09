import { adjacentPreloadDistance } from "../panes/pane-content-preloader.js";
import type { PaneId, PaneRenderItem, WorkspacePane } from "../types.js";
import { orderPaneActivation } from "./pane-picture-activation.js";
import { type CachedPanePicture } from "./pane-picture-cache.js";
import { PanePictureCaptureClient } from "./pane-picture-capture-client.js";
import { samePictureSurface } from "./pane-picture-configuration.js";
import {
  PanePicturePresentation,
  captureContentHasSize,
  hostReady,
  maxEncodedBytes,
  maxRasterBytes,
  type Batch,
  type Candidate,
  type ContentHost,
} from "./pane-picture-presentation.js";
import { pngDimensions, validatePictureDecode } from "./pane-picture-raster.js";
import type {
  OnirigiriCaptureStatus,
  OnirigiriPaneCaptureReceipt,
  OnirigiriPanePicture,
  OnirigiriPanePictureResolver,
} from "./pane-picture-types.js";

export class PanePictures extends PanePicturePresentation {
  protected cancel(): void {
    if (this.active && !this.active.abort.signal.aborted) {
      this.invalidated++;
      this.active.abort.abort();
      for (const pane of this.active.panes)
        if (this.attempts.get(pane.paneId)?.key === pane.key)
          this.attempts.delete(pane.paneId);
      this.publish();
    }
  }

  protected wake(delay = 0): void {
    if (!this.root) return;
    const at = Date.now() + delay;
    if (this.timer !== undefined && this.timerAt <= at) return;
    clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.timerAt = Infinity;
      void this.tick();
    }, delay);
  }

  protected idle(): boolean {
    return this.browserReady() && this.interaction.idle() && !this.moving();
  }

  protected pictureWorkAllowed(): boolean {
    return (
      this.captureUnavailable === null &&
      this.browserReady() &&
      this.interaction.canPreload() &&
      (!this.isContinuous() || !this.moving())
    );
  }

  protected preloadAllowed(): boolean {
    return (
      this.pictureWorkAllowed() && (!this.isContinuous() || !this.overview())
    );
  }

  protected browserReady(): boolean {
    const root = this.root;
    if (!root) return false;
    const view = root.ownerDocument.defaultView;
    if (!view) return false;
    return !root.ownerDocument.hidden && this.viewportReady;
  }

  protected async tick(): Promise<void> {
    if (!this.root || !this.captureEnabled()) return;
    if (this.busy || !this.pictureWorkAllowed()) {
      this.wake(100);
      return;
    }
    this.busy = true;
    try {
      await this.pictures.reconcile(() => this.pictureWorkAllowed());
      if (!this.idle()) {
        if (!this.moving()) this.preloadAdjacentContent();
        return;
      }
      await this.resolveSupplied();
      if (!this.idle() || !this.preloadAllowed()) return;
      await this.acquireContent();
    } finally {
      this.active = null;
      this.busy = false;
      this.publish();
      this.wake(100);
    }
  }

  protected async acquireContent(): Promise<void> {
    if (this.isContinuous()) {
      this.preloadAdjacentContent();
      return;
    }
    const view = this.root!.ownerDocument.defaultView;
    if (!this.deviceReady || !view) {
      this.preloadAdjacentContent();
      return;
    }
    if (this.overview()) this.prepareOverviewPane();
    else this.setOverviewPane(null);
    if (!this.overview() && !this.activation.settled()) return;
    const panes = this.candidates();
    if (!panes.length) {
      if (!this.overviewPane) this.preloadAdjacentContent();
      return;
    }
    this.preloader.activity();
    const batch = this.beginBatch(panes.slice(0, 1), view);
    this.publish();
    await this.captureWithDeadline(batch);
  }

  protected async captureWithDeadline(batch: Batch): Promise<void> {
    const deadline = setTimeout(() => {
      if (this.active !== batch || batch.abort.signal.aborted) return;
      this.reason = "Pane capture timed out";
      this.cancel();
    }, 10000);
    try {
      await this.capture(batch);
    } finally {
      clearTimeout(deadline);
      const id = batch.panes[0]?.paneId;
      if (
        id &&
        this.isOverviewCapture(id) &&
        !this.overviewPicturePresentable(id)
      )
        this.setOverviewPane(null);
    }
  }

  protected overviewPicturePresentable(id: PaneId): boolean {
    if (this.pictureMissing(id)) return false;
    const picture = this.pictures.get(id);
    return !picture?.pixelated || this.decision(id).detail === "preview";
  }

  protected overviewPictureHeldUnpresented(id: PaneId): boolean {
    return !this.pictureMissing(id) && !this.overviewPicturePresentable(id);
  }

  protected beginBatch(
    panes: Candidate[],
    view: Window,
    preload = false,
  ): Batch {
    const abort = new AbortController();
    const batch: Batch = {
      abort,
      id: view.crypto.randomUUID(),
      devicePixelRatio: view.devicePixelRatio,
      preload,
      overview: this.overview() && !preload,
      panes,
    };
    for (const pane of panes) {
      const old = this.attempts.get(pane.paneId);
      this.attempts.set(pane.paneId, {
        key: pane.key,
        failures: old?.key === pane.key ? old.failures : 0,
        retryAt: Infinity,
      });
    }
    this.active = batch;
    return batch;
  }

  protected candidates(): Candidate[] {
    const panes: Candidate[] = [];
    for (const item of orderPaneActivation(
      this.configuration.items,
      this.focused(),
    )) {
      const candidate = this.candidate(item);
      if (candidate) panes.push(candidate);
    }
    return panes;
  }

  protected captureEligible(item: PaneRenderItem): boolean {
    if (!item.visible) return false;
    if (this.overview())
      return (
        this.isOverviewCapture(item.paneId) && this.pictureMissing(item.paneId)
      );
    return !item.placeholderOnly && item.runtimeState === "live";
  }

  protected candidate(item: PaneRenderItem): Candidate | null {
    if (!this.captureEligible(item)) return null;
    const pane = this.configuration.panes.get(item.paneId);
    const host = this.hosts.get(item.paneId);
    if (!pane || !host || !hostReady(host)) return null;
    if (this.suppliedOnly(pane)) return null;
    return this.candidateAtBounds(pane, host, !this.overview());
  }

  protected candidateAtBounds(
    pane: WorkspacePane,
    host: ContentHost,
    recorded = false,
  ): Candidate | null {
    if (
      !this.canAcquire(pane.paneId, host) ||
      !captureContentHasSize(host.content)
    )
      return null;
    const revision = host.readiness.revision;
    const frame = recorded
      ? `frame-${host.surface.frameVersion}`
      : `epoch-${this.epoch}`;
    const key = `${frame}:${revision}:${host.content.offsetWidth}:${host.content.offsetHeight}`;
    const attempt = this.attempts.get(pane.paneId);
    if (attempt?.key === key && Date.now() < attempt.retryAt) return null;
    return {
      ...host,
      paneId: pane.paneId,
      pane,
      revision,
      bounds: new DOMRect(
        0,
        0,
        host.content.offsetWidth,
        host.content.offsetHeight,
      ),
      key,
    };
  }

  protected valid(batch: Batch): boolean {
    const valid =
      !batch.abort.signal.aborted &&
      this.preloadAllowed() &&
      (!batch.overview || this.isOverviewCapture(batch.panes[0]!.paneId)) &&
      batch.panes.every((pane) => this.currentCandidate(pane));
    if (!valid) this.cancel();
    return valid;
  }

  protected currentCandidate(candidate: Candidate): boolean {
    const pane = this.configuration.panes.get(candidate.paneId);
    const host = this.hosts.get(candidate.paneId);
    if (!pane || !host) return false;
    return (
      host.surface === candidate.surface &&
      hostReady(host) &&
      samePictureSurface(pane, candidate.pane) &&
      candidate.revision === host.readiness.revision &&
      candidate.content.isConnected &&
      candidate.content.offsetWidth === candidate.bounds.width &&
      candidate.content.offsetHeight === candidate.bounds.height
    );
  }

  protected async capture(batch: Batch): Promise<boolean> {
    try {
      if (!this.valid(batch)) return false;
      const pane = batch.panes[0]!;
      const result = await pane.surface.capture({
        signal: batch.abort.signal,
        stage: batch.preload || this.isOverviewCapture(pane.paneId),
        maxEncodedBytes,
        maxRasterBytes,
        background: batch.preload
          ? {
              client: (this.captureWorker ??= new PanePictureCaptureClient(
                pane.content.ownerDocument,
              )),
              id: batch.id,
            }
          : undefined,
      });
      if (!this.valid(batch)) return false;
      const receipt: OnirigiriPaneCaptureReceipt = {
        id: batch.id,
        devicePixelRatio: batch.devicePixelRatio,
        pixelsPerCss: {
          x: result.width / pane.bounds.width,
          y: result.height / pane.bounds.height,
        },
        bounds: {
          x: 0,
          y: 0,
          width: pane.bounds.width,
          height: pane.bounds.height,
        },
      };
      const accepted = await this.accept(
        pane.paneId,
        { image: result.image, fit: "fill", position: "left top" },
        result,
        () => this.valid(batch),
        {
          evict: !batch.preload,
          capture: receipt,
        },
      );
      this.recordCaptureOutcome(batch, result.image, receipt, accepted);
      this.reason = null;
      return accepted;
    } catch (error) {
      this.captureFailed(batch, error);
      return false;
    }
  }

  protected recordCaptureOutcome(
    batch: Batch,
    image: Blob,
    receipt: OnirigiriPaneCaptureReceipt,
    accepted: boolean,
  ): void {
    const paneId = batch.panes[0]!.paneId;
    if (!accepted) {
      const attempt = this.attempts.get(paneId);
      if (attempt) attempt.retryAt = Date.now() + 1000;
      return;
    }
    this.retireSeed(paneId);
    const captured = this.configuration.panes.get(paneId);
    if (
      captured &&
      batch.panes.every((candidate) => this.currentCandidate(candidate))
    )
      this.configuration.onCaptured?.(captured, image, receipt);
  }

  protected async capturePreload(
    paneId: PaneId,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (this.busy || !this.deviceReady || !this.root) return false;
    const host = this.hosts.get(paneId);
    const pane = this.configuration.panes.get(paneId);
    if (!host || !pane) return false;
    const candidate = this.candidateAtBounds(pane, host);
    if (!candidate) return false;
    this.busy = true;
    const batch = this.beginBatch(
      [candidate],
      this.root.ownerDocument.defaultView!,
      true,
    );
    const abort = () => batch.abort.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const deadline = setTimeout(() => batch.abort.abort(), 10000);
    this.publish();
    try {
      return await this.capture(batch);
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      if (this.active === batch) this.active = null;
      this.busy = false;
      this.publish();
      this.wake();
    }
  }

  protected captureFailed(batch: Batch, error: unknown): void {
    if (batch.abort.signal.aborted) return;
    this.rejected++;
    this.reason =
      error instanceof Error
        ? error.message.slice(0, 200)
        : "Pane capture failed";
    for (const pane of batch.panes) {
      const attempt = this.attempts.get(pane.paneId);
      if (!attempt) continue;
      attempt.failures++;
      attempt.retryAt =
        attempt.failures < 3
          ? Date.now() + 250 * 2 ** (attempt.failures - 1)
          : Infinity;
    }
  }

  protected async resolveSupplied(): Promise<void> {
    for (const [id, pane] of this.configuration.panes) {
      if (!this.idle()) return;
      const supplied = this.configuration.resolver?.(pane);
      this.reconcileSeed(id, supplied);
      if (supplied && !(await this.resolveSource(id, pane, supplied))) return;
    }
  }

  protected reconcileSeed(
    id: PaneId,
    supplied: OnirigiriPanePicture | null | undefined,
  ): void {
    const seed = this.seeds.get(id) ?? this.retiredSeeds.get(id)?.deref();
    if (seed === undefined) return;
    if (this.pictures.get(id)?.image !== seed) {
      this.seeds.delete(id);
      return;
    }
    if (supplied?.image === seed) return;
    this.retireSeed(id);
    if (!supplied) {
      this.pictures.release(id);
      this.publish();
    }
  }

  protected isSeed(id: PaneId): boolean {
    const seed = this.seeds.get(id);
    return seed !== undefined && this.pictures.get(id)?.image === seed;
  }

  protected retireSeed(id: PaneId): void {
    const seed = this.seeds.get(id);
    if (seed === undefined) return;
    this.retiredSeeds.set(id, new WeakRef(seed));
    this.seeds.delete(id);
  }

  protected seedSettled(id: PaneId, image: Blob): boolean {
    const current = this.pictures.get(id);
    if (current && this.retiredSeeds.get(id)?.deref() === image) return true;
    if (current?.capture) {
      this.retiredSeeds.set(id, new WeakRef(image));
      return true;
    }
    return current?.image === image;
  }

  protected pictureMissing(id: PaneId): boolean {
    return !this.pictures.has(id) || this.stalePictures.has(id);
  }

  protected suppliedOnly(pane: WorkspacePane): boolean {
    const supplied = this.configuration.resolver?.(pane);
    return Boolean(supplied && !supplied.replaceable);
  }

  protected updatePictureStyle(
    id: PaneId,
    supplied: OnirigiriPanePicture,
  ): void {
    const accepted = this.pictures.get(id);
    if (!accepted || accepted.capture || accepted.image !== supplied.image)
      return;
    const fit = supplied.fit ?? "contain";
    const position = supplied.position ?? "center";
    this.pictures.style(id, fit, position, supplied.cssSize);
  }

  protected suppliedCurrent(
    id: PaneId,
    pane: WorkspacePane,
    image: Blob,
    epoch: number,
    resolver: OnirigiriPanePictureResolver | undefined,
  ): boolean {
    return (
      this.idle() &&
      epoch === this.epoch &&
      this.configuration.panes.get(id) === pane &&
      resolver === this.configuration.resolver &&
      resolver?.(pane)?.image === image
    );
  }

  protected suppliedSettled(id: PaneId, image: Blob): boolean {
    const supplied = this.supplied.get(id);
    return (
      image === supplied?.image.deref() &&
      (supplied.failed || this.pictures.get(id)?.image === image)
    );
  }

  protected async resolveSource(
    id: PaneId,
    pane: WorkspacePane,
    supplied: OnirigiriPanePicture,
  ): Promise<boolean> {
    this.updatePictureStyle(id, supplied);
    if (
      (supplied.replaceable
        ? this.seedSettled(id, supplied.image)
        : this.suppliedSettled(id, supplied.image)) ||
      supplied.image === this.deferredSupplied.get(id)?.deref()
    )
      return true;
    this.deferredSupplied.set(id, new WeakRef(supplied.image));
    const epoch = this.epoch;
    const resolver = this.configuration.resolver;
    const current = () =>
      this.suppliedCurrent(id, pane, supplied.image, epoch, resolver) &&
      !(supplied.replaceable && this.pictures.get(id)?.capture);
    try {
      const size = await pngDimensions(
        supplied.image,
        maxEncodedBytes,
        maxRasterBytes,
      );
      if (!current()) return false;
      await validatePictureDecode(
        this.root!.ownerDocument,
        supplied.image,
        size,
      );
      if (!current()) return false;
      if (await this.accept(id, supplied, size, current)) {
        this.recordSuppliedResult(id, supplied, false);
      }
    } catch {
      this.recordSuppliedResult(id, supplied, true);
      this.rejected++;
    }
    return true;
  }

  protected recordSuppliedResult(
    id: PaneId,
    supplied: OnirigiriPanePicture,
    failed: boolean,
  ): void {
    this.supplied.set(id, { image: new WeakRef(supplied.image), failed });
    if (!failed && supplied.replaceable) this.seeds.set(id, supplied.image);
  }

  protected async accept(
    id: PaneId,
    source: OnirigiriPanePicture,
    size: { width: number; height: number },
    valid: () => boolean,
    options: { capture?: OnirigiriPaneCaptureReceipt; evict?: boolean } = {},
  ): Promise<boolean> {
    const accepted = await this.pictures.accept(id, source, size, valid, {
      ...options,
      revision: this.accepted + 1,
    });
    if (accepted) {
      this.accepted++;
      if (
        source.replaceable &&
        this.retiredSeeds.get(id)?.deref() === source.image
      )
        this.stalePictures.add(id);
      else this.stalePictures.delete(id);
    } else this.rejected++;
    this.publish();
    return accepted;
  }

  protected preloadAdjacentContent(): void {
    if (!this.backgroundReady()) return;
    const margin = this.configuration.preloadMarginPanes ?? 0;
    const all =
      (this.configuration.preloadAllPanePictures ||
        this.configuration.liveContent) &&
      this.idle();
    if (!margin && !all) return;
    const viewport = all
      ? null
      : (
          this.root!.querySelector('[data-onirigiri-slot="stage"]') ??
          this.root!
        ).getBoundingClientRect();
    const candidates = orderPaneActivation(
      this.configuration.items,
      this.focused(),
    ).flatMap((item) => this.preloadCandidate(item, viewport, margin));
    this.preloader.advance(candidates);
  }

  protected backgroundReady(): boolean {
    return Boolean(
      this.deviceReady &&
      this.preloadAllowed() &&
      (!this.isContinuous() || this.idle()) &&
      this.root &&
      (this.moving() || this.activation.settled()),
    );
  }

  protected preloadCandidate(
    item: PaneRenderItem,
    viewport: DOMRect | null,
    margin: number,
  ) {
    const host = this.preloadHost(item);
    if (!host) return [];
    if (viewport) {
      const bounds = (
        host.content.closest('[data-onirigiri-slot="pane"]') ?? host.content
      ).getBoundingClientRect();
      if (adjacentPreloadDistance(bounds, viewport, margin) === null) return [];
    }
    return [
      {
        ...host,
        item,
        current: () => this.currentPreload(item, host),
      },
    ];
  }

  protected preloadHost(item: PaneRenderItem): ContentHost | null {
    const host = this.hosts.get(item.paneId);
    if (
      !host ||
      this.preloadBlocked(item.paneId, host) ||
      this.pictureMatchesContent(item.paneId, host) ||
      this.preloadWouldCoverContent(item, host)
    )
      return null;
    return host;
  }

  protected preloadBlocked(
    paneId: PaneId,
    host: ContentHost,
  ): boolean | undefined {
    return (
      this.frozenSurface(paneId, host) ||
      !this.canAcquire(paneId, host) ||
      ["dom", "canvas", "placeholder"].includes(
        this.decision(paneId).requested,
      ) ||
      (this.isContinuous() && this.isLive(paneId)) ||
      (this.configuration.liveContent &&
        !this.isPreloading(paneId) &&
        !host.readiness.getSnapshot())
    );
  }

  protected pictureMatchesContent(paneId: PaneId, host: ContentHost): boolean {
    if (this.stalePictures.has(paneId)) return false;
    const picture = this.pictures.get(paneId);
    if (!picture) return false;
    if (!picture.capture) return !this.isSeed(paneId);
    return (
      picture.capture.bounds.width === host.content.offsetWidth &&
      picture.capture.bounds.height === host.content.offsetHeight
    );
  }

  protected canAcquire(paneId: PaneId, host: ContentHost): boolean {
    if (host.mounted() && host.readiness.getSnapshot()) {
      if (host.surface.canCapture()) this.captureExcluded.delete(paneId);
      else this.captureExcluded.add(paneId);
    }
    return !this.captureExcluded.has(paneId);
  }

  protected currentPreload(item: PaneRenderItem, host: ContentHost): boolean {
    const current = this.itemsById.get(item.paneId);
    return (
      this.hosts.get(item.paneId) === host &&
      current !== undefined &&
      current.width === item.width &&
      current.height === item.height &&
      !this.preloadWouldCoverContent(current, host)
    );
  }

  protected preloadWouldCoverContent(
    item: PaneRenderItem,
    host: ContentHost,
  ): boolean {
    if (this.decision(item.paneId).kind === "texture") return false;
    return (
      (item.visible && item.presentationMode === "normal") ||
      (this.overview() && host.drawn)
    );
  }

  finishOverviewCapture(
    paneId: PaneId,
    picture: CachedPanePicture | null = this.get(paneId),
  ): void {
    if (
      !this.isOverviewCapture(paneId) ||
      !picture ||
      this.stalePictures.has(paneId) ||
      this.get(paneId) !== picture
    )
      return;
    this.setOverviewPane(null);
    this.wake(100);
  }

  protected setOverviewPane(paneId: PaneId | null): void {
    const previous = this.overviewPane?.paneId;
    if (previous === paneId || (!previous && !paneId)) return;
    if (paneId) this.preloader.activity();
    this.overviewPane = paneId
      ? { paneId, deadline: Date.now() + 10000 }
      : null;
    if (previous) this.emit(previous);
    if (paneId) this.emit(paneId);
    this.publish();
  }

  protected prepareOverviewPane(): void {
    if (!this.configuration.captureMissingOverviewPictures) {
      this.setOverviewPane(null);
      return;
    }
    if (this.overviewPane) {
      if (
        Date.now() < this.overviewPane.deadline &&
        !this.overviewPictureHeldUnpresented(this.overviewPane.paneId)
      )
        return;
      this.setOverviewPane(null);
    }
    const view = this.root?.ownerDocument.defaultView;
    if (!view) return;
    const item = orderPaneActivation(
      this.configuration.items,
      this.focused(),
    ).find((item) => this.missingOverviewPicture(item, view));
    if (!item) return;
    this.overviewAttempts.add(item.paneId);
    this.setOverviewPane(item.paneId);
  }

  protected overviewPicturePending(item: PaneRenderItem): boolean {
    return (
      item.visible &&
      this.pictureMissing(item.paneId) &&
      !this.overviewAttempts.has(item.paneId)
    );
  }

  protected missingOverviewPicture(
    item: PaneRenderItem,
    view: Window,
  ): boolean {
    if (!this.overviewPicturePending(item)) return false;
    const pane = this.configuration.panes.get(item.paneId);
    const host = this.hosts.get(item.paneId);
    if (!pane || !host || this.suppliedOnly(pane)) return false;
    return (
      this.canAcquire(item.paneId, host) &&
      host.content.isConnected &&
      view.innerWidth > 0
    );
  }

  protected captureState(): OnirigiriCaptureStatus["state"] {
    if (this.captureUnavailable !== null || this.reason) return "unavailable";
    if (!this.device) return "unconfigured";
    return this.active || this.overviewPane ? "capturing" : "idle";
  }

  protected publish(): void {
    const next: OnirigiriCaptureStatus = {
      state: this.captureState(),
      reason: this.captureUnavailable ?? this.reason,
      pictureBytes: this.pictures.bytes,
      pictureRasterBytes: this.pictures.rasterBytes,
      overviewPaneId: this.overviewPane?.paneId ?? null,
      preloadingPaneId: this.preloader.paneId,
      pictures: [...this.pictures].map(([paneId, picture]) => ({
        paneId,
        revision: picture.revision,
        capture: picture.capture,
        width: picture.width,
        height: picture.height,
        pixelated: picture.pixelated,
      })),
      inFlightPaneIds: this.active?.panes.map((pane) => pane.paneId) ?? [],
      accepted: this.accepted,
      rejected: this.rejected,
      invalidated: this.invalidated,
    };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.configuration.onStatus?.(next);
  }
}
