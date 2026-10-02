import type { PaneId, PaneRenderItem, PaneWorldBox, Rect } from "../types.js";
import type { WorkspaceLayoutSnapshot } from "../state/layout-store.js";
import type { WorkspacePresentedPaneGeometry } from "./workspace-motion-presentation.js";
import {
  displayedPaneBox,
  hasFiniteTransformCoordinates,
  interpolatedPaneGeometry,
  normalizedPaneScale,
  paneBoxForItem,
  presentedPaneGeometry,
  presentedPaneGeometryWithoutBinding,
  samePaneBox,
  storedPaneTransform,
  type PaneRearrangement,
  type PresentedPaneGeometry,
} from "./pane-presentation-geometry.js";

const paneRearrangementDurationMs = 160;

interface PaneHostBinding {
  host: HTMLElement;
  lastContentOffsetTop: number;
  lastCornerRadius: number;
  lastFocused: boolean | null;
  lastFrozen: boolean | null;
  lastHeight: number;
  lastHidden: boolean | null;
  lastInert: boolean | null;
  lastMaximized: boolean | null;
  lastMeasurementKey: string | null;
  lastMoving: boolean | null;
  lastOpacity: number;
  lastPresentationMode: string | null;
  lastRuntimeState: string | null;
  lastTransform: string;
  lastTransformScale: number;
  lastTransformX: number;
  lastTransformY: number;
  lastVisible: boolean | null;
  lastWidth: number;
  lastZ: number;
  paneRearrangement: PaneRearrangement | null;
  paneRearrangementProgress: number;
}

export interface PanePresentationWriteCounts {
  attributeWrites: number;
  boxWrites: number;
  transformWrites: number;
}

export class PanePresentationEngine {
  private readonly pendingMeasurements = new Set<PaneHostBinding>();
  private readonly bindings = new Map<PaneId, PaneHostBinding>();
  private defaultPaneCornerRadius = 0;
  private defaultPaneContentOffsetTop = 0;
  private readonly itemByPaneId = new Map<PaneId, PaneRenderItem>();
  private readonly pendingPaneRearrangements = new Map<
    PaneId,
    PaneRearrangement
  >();
  private lastOverviewProgress = "";
  private lastOverviewTransitioning: boolean | null = null;
  private lastViewportHeight = Number.NaN;
  private lastViewportWidth = Number.NaN;
  private paneRearrangementElapsedMs = paneRearrangementDurationMs;
  private workspaceHost: HTMLElement | null = null;

  bindWorkspace(host: HTMLElement | null): void {
    if (this.workspaceHost !== host) {
      this.workspaceHost?.classList.remove(
        "onirigiri-workspace--overview-transition",
      );
      this.lastOverviewProgress = "";
      this.lastOverviewTransitioning = null;
      this.lastViewportHeight = Number.NaN;
      this.lastViewportWidth = Number.NaN;
      this.defaultPaneContentOffsetTop = host
        ? workspaceTitlebarHeight(host)
        : 0;
      this.defaultPaneCornerRadius = 0;
    }
    this.workspaceHost = host;
  }

  registerPaneHost(
    paneId: PaneId,
    host: HTMLElement,
    initialItem?: PaneRenderItem,
    compactLayout = false,
  ): () => void {
    const binding = createPaneHostBinding(host);
    this.bindings.set(paneId, binding);
    const item = initialItem ?? this.itemByPaneId.get(paneId);
    if (item) {
      const counts = emptyWriteCounts();
      preparePendingPaneRearrangement({
        binding,
        counts,
        item,
        paneId,
        pendingPaneRearrangements: this.pendingPaneRearrangements,
        progress: this.paneRearrangementProgress(),
      });
      applyPaneHost(binding, item, counts, { compactLayout });
      this.queueMeasurement(binding, item, compactLayout);
    }
    return () => {
      const binding = this.bindings.get(paneId);
      if (binding?.host === host) {
        this.pendingMeasurements.delete(binding);
        this.bindings.delete(paneId);
      }
    };
  }

  hasPaneHost(paneId: PaneId): boolean {
    return this.bindings.has(paneId);
  }

  updatePaneHostBoundary(
    paneId: PaneId,
    item: PaneRenderItem,
    compactLayout = false,
  ): PanePresentationWriteCounts {
    const binding = this.bindings.get(paneId);
    if (!binding) {
      throw new Error(`Pane host ${paneId} is not registered.`);
    }
    const counts = emptyWriteCounts();
    preparePendingPaneRearrangement({
      binding,
      counts,
      item,
      paneId,
      pendingPaneRearrangements: this.pendingPaneRearrangements,
      progress: this.paneRearrangementProgress(),
    });
    applyPaneHost(binding, item, counts, { compactLayout });
    this.queueMeasurement(binding, item, compactLayout);
    return counts;
  }

  presentedPaneGeometries(
    items: readonly PaneRenderItem[],
  ): WorkspacePresentedPaneGeometry[] {
    this.measurePendingContent();
    return items.map((item) => {
      const binding = this.bindings.get(item.paneId);
      const pending = this.pendingPaneRearrangements.get(item.paneId);
      const geometry = binding
        ? presentedPaneGeometry(binding, item)
        : pending
          ? interpolatedPaneGeometry(
              pending,
              this.paneRearrangementProgress(),
              item,
            )
          : presentedPaneGeometryWithoutBinding(item);
      return {
        ...geometry,
        contentOffsetTop: finitePaneMetric(
          binding?.lastContentOffsetTop,
          this.defaultContentOffsetTop(),
        ),
        cornerRadius: finitePaneMetric(
          binding?.lastCornerRadius,
          this.defaultContentCornerRadius(),
        ),
        opacity: item.opacity,
        paneId: item.paneId,
        preload: item.preload === true,
        presentationMode: item.presentationMode,
        visible: item.visible,
        targetHeight: item.height,
        targetScale: item.scale,
        targetWidth: item.width,
        z: item.z,
      };
    });
  }

  apply(
    items: readonly PaneRenderItem[],
    snapshot: WorkspaceLayoutSnapshot,
    compactLayout: boolean,
    viewport: Rect,
  ): PanePresentationWriteCounts {
    const counts = emptyWriteCounts();
    const presentationContext = {
      compactLayout,
    };
    this.itemByPaneId.clear();
    for (const item of items) {
      this.itemByPaneId.set(item.paneId, item);
    }
    for (const [paneId, binding] of this.bindings) {
      const item = this.itemByPaneId.get(paneId);
      if (!item) {
        hidePaneHost(binding, counts);
        continue;
      }
      applyPaneHost(binding, item, counts, presentationContext);
    }
    this.applyWorkspaceState(snapshot, viewport);
    this.measurePendingContent();
    return counts;
  }

  presentWorkspace(snapshot: WorkspaceLayoutSnapshot, viewport: Rect): void {
    this.applyWorkspaceState(snapshot, viewport);
  }

  retargetPaneRearrangement(
    items: readonly PaneRenderItem[],
    sourceItems: readonly PaneWorldBox[] = [],
  ): boolean {
    const itemByPaneId = new Map(items.map((item) => [item.paneId, item]));
    const sourceItemByPaneId = new Map(
      sourceItems.map((item) => [item.paneId, item]),
    );
    this.pendingPaneRearrangements.clear();
    const changedMounted = this.retargetPaneHosts(itemByPaneId);
    const changedIngress = this.queuePendingPaneRearrangements(
      itemByPaneId,
      sourceItemByPaneId,
    );
    const changed = changedMounted || changedIngress;
    if (!changed) {
      return false;
    }
    this.paneRearrangementElapsedMs = 0;
    return true;
  }

  followPaneRearrangementCameraOffset(
    items: readonly PaneRenderItem[],
    focusedPaneId: PaneId,
  ): { x: number; y: number } | null {
    const focusedBinding = this.bindings.get(focusedPaneId);
    const focusedItem = items.find((item) => item.paneId === focusedPaneId);
    const from = focusedBinding ? displayedPaneBox(focusedBinding) : null;
    const to = focusedItem ? paneBoxForItem(focusedItem) : null;
    if (!from || !to) {
      return null;
    }
    const x = from.x - to.x;
    const y = from.y - to.y;
    return Math.abs(x) <= 0.001 && Math.abs(y) <= 0.001 ? null : { x, y };
  }

  compensatePaneHostsForCameraOffset(offset: { x: number; y: number }): void {
    for (const binding of this.bindings.values()) {
      if (!hasFiniteTransformCoordinates(binding)) {
        continue;
      }
      binding.lastTransformX -= offset.x;
      binding.lastTransformY -= offset.y;
    }
  }

  private retargetPaneHosts(
    itemByPaneId: ReadonlyMap<PaneId, PaneRenderItem>,
  ): boolean {
    let changed = false;
    for (const [paneId, binding] of this.bindings) {
      const item = itemByPaneId.get(paneId);
      if (!item || !item.visible) {
        continue;
      }
      const from = displayedPaneBox(binding);
      const to = paneBoxForItem(item);
      if (!from || samePaneBox(from, to)) {
        binding.paneRearrangement = null;
        continue;
      }
      binding.paneRearrangement = {
        from,
        fromScale: binding.lastTransformScale,
      };
      binding.paneRearrangementProgress = 0;
      changed = true;
    }
    return changed;
  }

  private queuePendingPaneRearrangements(
    itemByPaneId: ReadonlyMap<PaneId, PaneRenderItem>,
    sourceItemByPaneId: ReadonlyMap<PaneId, PaneWorldBox>,
  ): boolean {
    let changed = false;
    for (const [paneId, item] of itemByPaneId) {
      if (this.bindings.has(paneId) || !item.visible) {
        continue;
      }
      const source = sourceItemByPaneId.get(paneId);
      if (!source) {
        continue;
      }
      const from = paneBoxForItem(source);
      const to = paneBoxForItem(item);
      if (samePaneBox(from, to)) {
        continue;
      }
      this.pendingPaneRearrangements.set(paneId, {
        from,
        fromScale: normalizedPaneScale(source.scale),
      });
      changed = true;
    }
    return changed;
  }

  private paneRearrangementProgress(): number {
    return Math.min(
      1,
      Math.max(
        0,
        this.paneRearrangementElapsedMs / paneRearrangementDurationMs,
      ),
    );
  }

  advancePaneRearrangement(deltaMs: number): boolean {
    if (!this.hasActivePaneRearrangement()) {
      return false;
    }
    this.paneRearrangementElapsedMs = Math.min(
      paneRearrangementDurationMs,
      this.paneRearrangementElapsedMs + Math.max(0, deltaMs),
    );
    const progress =
      this.paneRearrangementElapsedMs / paneRearrangementDurationMs;
    for (const binding of this.bindings.values()) {
      if (binding.paneRearrangement) {
        binding.paneRearrangementProgress = progress;
      }
    }
    if (this.paneRearrangementElapsedMs >= paneRearrangementDurationMs) {
      for (const binding of this.bindings.values()) {
        if (!binding.paneRearrangement) {
          continue;
        }
        binding.paneRearrangement = null;
      }
      this.pendingPaneRearrangements.clear();
    }
    return this.hasActivePaneRearrangement();
  }

  hasActivePaneRearrangement(): boolean {
    if (this.paneRearrangementElapsedMs >= paneRearrangementDurationMs) {
      return false;
    }
    return (
      this.pendingPaneRearrangements.size > 0 ||
      [...this.bindings.values()].some(
        (binding) => binding.paneRearrangement !== null,
      )
    );
  }

  snapPaneRearrangement(): void {
    this.paneRearrangementElapsedMs = paneRearrangementDurationMs;
    for (const binding of this.bindings.values()) {
      binding.paneRearrangement = null;
      binding.paneRearrangementProgress = 1;
    }
    this.pendingPaneRearrangements.clear();
  }

  private applyWorkspaceState(
    snapshot: WorkspaceLayoutSnapshot,
    viewport: Rect,
  ): void {
    if (!this.workspaceHost) {
      return;
    }
    const overviewProgress = snapshot.overviewProgress.toFixed(4);
    if (this.lastOverviewProgress !== overviewProgress) {
      this.lastOverviewProgress = overviewProgress;
      this.workspaceHost.setAttribute(
        "data-overview-progress",
        overviewProgress,
      );
    }
    const overviewTransitioning = overviewTransitionIsActive(snapshot);
    if (this.lastOverviewTransitioning !== overviewTransitioning) {
      this.lastOverviewTransitioning = overviewTransitioning;
      this.workspaceHost.classList.toggle(
        "onirigiri-workspace--overview-transition",
        overviewTransitioning,
      );
    }
    if (this.lastViewportHeight !== viewport.height) {
      this.lastViewportHeight = viewport.height;
      this.workspaceHost.style.setProperty(
        "--onirigiri-viewport-height",
        `${viewport.height.toFixed(2)}px`,
      );
    }
    if (this.lastViewportWidth !== viewport.width) {
      this.lastViewportWidth = viewport.width;
      this.workspaceHost.style.setProperty(
        "--onirigiri-viewport-width",
        `${viewport.width.toFixed(2)}px`,
      );
    }
  }

  private queueMeasurement(
    binding: PaneHostBinding,
    item: PaneRenderItem,
    compactLayout: boolean,
  ): void {
    const key = `${item.maximized}:${item.presentationMode}:${compactLayout}`;
    if (binding.lastMeasurementKey === key) return;
    binding.lastMeasurementKey = key;
    this.pendingMeasurements.add(binding);
  }

  private measurePendingContent(): void {
    for (const binding of this.pendingMeasurements) {
      if (!binding.lastVisible) continue;
      this.measurePaneContent(binding);
      this.pendingMeasurements.delete(binding);
    }
  }

  private measurePaneContent(binding: PaneHostBinding): void {
    const ownerWindow = binding.host.ownerDocument.defaultView;
    const cornerRadius = ownerWindow
      ? pixelLength(
          ownerWindow.getComputedStyle(binding.host).borderBottomLeftRadius,
        )
      : null;
    if (cornerRadius !== null) {
      binding.lastCornerRadius = cornerRadius;
      this.defaultPaneCornerRadius = cornerRadius;
    }
    const content = paneContentElement(binding.host);
    if (!content) {
      return;
    }
    const offsetTop = Math.max(0, content.offsetTop);
    if (Number.isFinite(offsetTop)) {
      binding.lastContentOffsetTop = offsetTop;
      this.defaultPaneContentOffsetTop = offsetTop;
    }
  }

  private defaultContentOffsetTop(): number {
    return this.defaultPaneContentOffsetTop;
  }

  private defaultContentCornerRadius(): number {
    return this.defaultPaneCornerRadius;
  }
}

function workspaceTitlebarHeight(host: HTMLElement): number {
  const ownerWindow = host.ownerDocument.defaultView;
  if (!ownerWindow) {
    return 0;
  }
  const value = Number.parseFloat(
    ownerWindow
      .getComputedStyle(host)
      .getPropertyValue("--onirigiri-titlebar-min-height"),
  );
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function pixelLength(value: string): number | null {
  if (!value.trim().endsWith("px")) {
    return null;
  }
  const length = Number.parseFloat(value);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

function finitePaneMetric(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function overviewTransitionIsActive(
  snapshot: WorkspaceLayoutSnapshot,
): boolean {
  const overviewTarget = snapshot.presentationMode === "overview" ? 1 : 0;
  return Math.abs(snapshot.overviewProgress - overviewTarget) > 0.001;
}

function createPaneHostBinding(host: HTMLElement): PaneHostBinding {
  return {
    host,
    lastContentOffsetTop: Number.NaN,
    lastCornerRadius: Number.NaN,
    lastFocused: null,
    lastMeasurementKey: null,
    lastFrozen: null,
    lastHeight: Number.NaN,
    lastHidden: null,
    lastInert: null,
    lastMaximized: null,
    lastMoving: null,
    lastOpacity: Number.NaN,
    lastPresentationMode: null,
    lastRuntimeState: null,
    lastTransform: "",
    lastTransformScale: Number.NaN,
    lastTransformX: Number.NaN,
    lastTransformY: Number.NaN,
    lastVisible: null,
    lastWidth: Number.NaN,
    lastZ: Number.NaN,
    paneRearrangement: null,
    paneRearrangementProgress: 1,
  };
}

function preparePendingPaneRearrangement({
  binding,
  counts,
  item,
  paneId,
  pendingPaneRearrangements,
  progress,
}: {
  binding: PaneHostBinding;
  counts: PanePresentationWriteCounts;
  item: PaneRenderItem;
  paneId: PaneId;
  pendingPaneRearrangements: Map<PaneId, PaneRearrangement>;
  progress: number;
}): void {
  const pending = pendingPaneRearrangements.get(paneId);
  if (!pending || binding.paneRearrangement) {
    return;
  }
  pendingPaneRearrangements.delete(paneId);
  const destination = paneBoxForItem(item);
  if (samePaneBox(pending.from, destination)) {
    return;
  }
  const sourceGeometry: PresentedPaneGeometry = {
    height: pending.from.height / pending.fromScale,
    scale: pending.fromScale,
    width: pending.from.width / pending.fromScale,
    x: pending.from.x,
    y: pending.from.y,
  };
  counts.boxWrites += writeBox(binding, sourceGeometry);
  binding.lastTransformX = sourceGeometry.x;
  binding.lastTransformY = sourceGeometry.y;
  binding.lastTransformScale = sourceGeometry.scale;
  counts.transformWrites += writeStoredTransform(binding);
  binding.paneRearrangement = pending;
  binding.paneRearrangementProgress = progress;
}

function applyPaneHost(
  binding: PaneHostBinding,
  item: PaneRenderItem,
  counts: PanePresentationWriteCounts,
  context: PaneHostPresentationContext,
): void {
  const geometry = presentedPaneGeometry(binding, item);
  counts.boxWrites += writeBox(binding, geometry);
  const writes = applyPaneHostAttributes(binding, item);
  applyPaneHostInteractionState(binding, item, context.compactLayout, writes);
  if (writes.runtimeStateWrites > 0) {
    syncContentLifecycle(binding.host, item);
  }
  counts.attributeWrites += writes.attributeWrites;
  applyPaneHostVisualState(binding, item, geometry, counts);
}

function applyPaneHostAttributes(
  binding: PaneHostBinding,
  item: PaneRenderItem,
): PaneHostAttributeWrites {
  let attributeWrites = 0;
  attributeWrites += writeBooleanDataset(
    binding,
    "focused",
    "lastFocused",
    item.focused,
  );
  attributeWrites += writeBooleanDataset(
    binding,
    "frozen",
    "lastFrozen",
    item.runtimeState === "frozen",
  );
  attributeWrites += writeBooleanDataset(
    binding,
    "maximized",
    "lastMaximized",
    item.maximized,
  );
  attributeWrites += writeBooleanDataset(
    binding,
    "moving",
    "lastMoving",
    item.moving,
  );
  const visibleWrites = writeBooleanDataset(
    binding,
    "visible",
    "lastVisible",
    item.visible,
  );
  attributeWrites += visibleWrites;
  attributeWrites += writeStringDataset(
    binding,
    "presentationMode",
    "lastPresentationMode",
    item.presentationMode,
  );
  const runtimeStateWrites = writeStringDataset(
    binding,
    "runtimeState",
    "lastRuntimeState",
    item.runtimeState,
  );
  return {
    attributeWrites: attributeWrites + runtimeStateWrites,
    runtimeStateWrites,
    visibleWrites,
  };
}

function applyPaneHostInteractionState(
  binding: PaneHostBinding,
  item: PaneRenderItem,
  compactLayout: boolean,
  writes: PaneHostAttributeWrites,
): void {
  const { host } = binding;
  writes.attributeWrites += writeHostHidden(binding, false);
  if (writes.visibleWrites > 0) {
    host.style.pointerEvents = item.visible ? "" : "none";
  }
  const inert = paneHostIsInert(item, compactLayout);
  if (binding.lastInert !== inert) {
    binding.lastInert = inert;
    host.toggleAttribute("inert", inert);
    host.inert = inert;
    writes.attributeWrites += 1;
  }
}

function paneHostIsInert(
  item: PaneRenderItem,
  compactLayout: boolean,
): boolean {
  return (
    !item.visible ||
    (compactLayout && item.presentationMode === "normal" && !item.focused)
  );
}

function applyPaneHostVisualState(
  binding: PaneHostBinding,
  item: PaneRenderItem,
  geometry: PresentedPaneGeometry,
  counts: PanePresentationWriteCounts,
): void {
  counts.transformWrites += writeTransform(binding, geometry);
  counts.attributeWrites += writeNumberStyle(
    binding,
    "lastOpacity",
    item.opacity,
    "opacity",
    item.opacity.toFixed(3),
  );
  counts.attributeWrites += writeNumberStyle(
    binding,
    "lastZ",
    item.z,
    "zIndex",
    String(item.z),
  );
}

interface PaneHostPresentationContext {
  compactLayout: boolean;
}

interface PaneHostAttributeWrites {
  attributeWrites: number;
  runtimeStateWrites: number;
  visibleWrites: number;
}

function hidePaneHost(
  binding: PaneHostBinding,
  counts: PanePresentationWriteCounts,
): void {
  const { host } = binding;
  counts.attributeWrites += writeHostHidden(binding, true);
  const visibleWrites = writeBooleanDataset(
    binding,
    "visible",
    "lastVisible",
    false,
  );
  counts.attributeWrites += visibleWrites;
  if (binding.lastOpacity !== 0) {
    binding.lastOpacity = 0;
    host.style.opacity = "0";
    counts.attributeWrites += 1;
  }
  if (binding.lastInert !== true) {
    binding.lastInert = true;
    host.toggleAttribute("inert", true);
    host.inert = true;
    counts.attributeWrites += 1;
  }
  if (visibleWrites > 0) {
    host.style.pointerEvents = "none";
  }
}

function writeHostHidden(binding: PaneHostBinding, hidden: boolean): number {
  if (binding.lastHidden === hidden) {
    return 0;
  }
  binding.lastHidden = hidden;
  binding.host.hidden = hidden;
  return 1;
}

function writeTransform(
  binding: PaneHostBinding,
  geometry: PresentedPaneGeometry,
): number {
  binding.lastTransformX = geometry.x;
  binding.lastTransformY = geometry.y;
  binding.lastTransformScale = geometry.scale;
  return writeStoredTransform(binding);
}

function writeStoredTransform(binding: PaneHostBinding): number {
  const transform = storedPaneTransform(binding);
  if (transform === null || binding.lastTransform === transform) {
    return 0;
  }
  binding.lastTransform = transform;
  binding.host.style.transform = transform;
  return 1;
}

function paneContentElement(host: HTMLElement): HTMLElement | null {
  for (const child of host.children) {
    if (child.classList.contains("onirigiri-pane__content")) {
      return child as HTMLElement;
    }
  }
  return null;
}

function writeBox(
  binding: PaneHostBinding,
  geometry: PresentedPaneGeometry,
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

function writeNumberStyle(
  binding: PaneHostBinding,
  cacheKey: "lastOpacity" | "lastZ",
  value: number,
  styleKey: "opacity" | "zIndex",
  serializedValue: string,
): number {
  if (binding[cacheKey] === value) {
    return 0;
  }
  binding[cacheKey] = value;
  binding.host.style[styleKey] = serializedValue;
  return 1;
}

function writeBooleanDataset(
  binding: PaneHostBinding,
  datasetKey: "focused" | "frozen" | "maximized" | "moving" | "visible",
  cacheKey:
    | "lastFocused"
    | "lastFrozen"
    | "lastMaximized"
    | "lastMoving"
    | "lastVisible",
  value: boolean,
): number {
  if (binding[cacheKey] === value) {
    return 0;
  }
  binding[cacheKey] = value;
  binding.host.setAttribute(booleanDataAttribute[datasetKey], String(value));
  return 1;
}

function writeStringDataset(
  binding: PaneHostBinding,
  datasetKey: "presentationMode" | "runtimeState",
  cacheKey: "lastPresentationMode" | "lastRuntimeState",
  value: string,
): number {
  if (binding[cacheKey] === value) {
    return 0;
  }
  binding[cacheKey] = value;
  binding.host.setAttribute(stringDataAttribute[datasetKey], value);
  return 1;
}

const booleanDataAttribute = {
  focused: "data-focused",
  frozen: "data-frozen",
  maximized: "data-maximized",
  moving: "data-moving",
  visible: "data-visible",
} as const;

const stringDataAttribute = {
  presentationMode: "data-presentation-mode",
  runtimeState: "data-runtime-state",
} as const;

function syncContentLifecycle(host: HTMLElement, item: PaneRenderItem): void {
  const content = host.querySelector<HTMLElement>(".onirigiri-pane__content");
  const liveContent = host.querySelector<HTMLElement>(
    ".onirigiri-pane__live-content",
  );
  if (!content || !liveContent) {
    return;
  }
  if (content.dataset.onirigiriContinuous !== "true")
    content.dataset.runtimeState = item.runtimeState;
  const interactive =
    item.runtimeState === "live" &&
    !item.moving &&
    item.presentationMode === "normal" &&
    content.dataset.onirigiriContentReady !== "false";
  liveContent.toggleAttribute("inert", !interactive);
  liveContent.inert = !interactive;
  liveContent.setAttribute("aria-hidden", String(!interactive));
}

function emptyWriteCounts(): PanePresentationWriteCounts {
  return { attributeWrites: 0, boxWrites: 0, transformWrites: 0 };
}
