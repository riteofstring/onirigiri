import { columnSlotIndex } from "./column-slots.js";
import type { WorkspaceLikeLayoutEngine } from "./layout-engine.js";
import { minimumColumnWidth } from "./layout-engine-helpers.js";
import { minimumPaneHeightPx } from "../panes/pane-resize-geometry.js";
import type {
  PaneId,
  PaneSizeTarget,
  PaneSizingMode,
  Rect,
  WorkspaceScene,
} from "../types.js";

interface PaneSizingTargetsInput {
  currentSizes: readonly PaneSizeTarget[];
  mode: Exclude<PaneSizingMode, "default">;
  scene: WorkspaceScene;
  viewport: Rect;
  workspace: HTMLElement | null;
}

interface PaneSize {
  heightPx: number;
  widthPx: number;
}

export function paneSizingTargets({
  currentSizes,
  mode,
  scene,
  viewport,
  workspace,
}: PaneSizingTargetsInput): PaneSizeTarget[] {
  const maximum = maximumPaneSize(scene, viewport);
  if (mode === "minimum") {
    return scene.panes.map((pane) => ({
      heightPx: minimumPaneHeightPx,
      paneId: pane.paneId,
      widthPx: minimumColumnWidth,
    }));
  }
  if (mode === "full") {
    return scene.panes.map((pane) => ({ paneId: pane.paneId, ...maximum }));
  }

  const currentSizeByPaneId = new Map(
    currentSizes.map((size) => [size.paneId, size]),
  );
  const measuredSizeByPaneId = workspace
    ? measureMountedPanes(workspace, maximum)
    : new Map<PaneId, PaneSize>();
  return scene.panes.map((pane) => {
    const measured = measuredSizeByPaneId.get(pane.paneId);
    const current = currentSizeByPaneId.get(pane.paneId);
    return {
      heightPx: clampPaneSize(
        measured?.heightPx ?? current?.heightPx,
        minimumPaneHeightPx,
        maximum.heightPx,
      ),
      paneId: pane.paneId,
      widthPx: clampPaneSize(
        measured?.widthPx ?? current?.widthPx,
        minimumColumnWidth,
        maximum.widthPx,
      ),
    };
  });
}

function maximumPaneSize(scene: WorkspaceScene, viewport: Rect): PaneSize {
  return {
    heightPx: Math.max(
      minimumPaneHeightPx,
      Math.round(viewport.height - scene.padding * 2),
    ),
    widthPx: Math.max(
      minimumColumnWidth,
      Math.round(viewport.width - scene.padding * 2),
    ),
  };
}

export function applyPaneSizeTargets(
  engine: WorkspaceLikeLayoutEngine,
  scene: WorkspaceScene,
  targets: readonly PaneSizeTarget[],
): boolean {
  const targetByPaneId = validPaneSizeTargets(scene, targets);
  if (targetByPaneId.size === 0) {
    return false;
  }
  resizeColumnsForPaneTargets(engine, scene, targetByPaneId);
  for (const target of targetByPaneId.values()) {
    engine.resizePane(target.paneId, target.heightPx);
  }
  return true;
}

function validPaneSizeTargets(
  scene: WorkspaceScene,
  targets: readonly PaneSizeTarget[],
): Map<PaneId, PaneSizeTarget> {
  return new Map(
    targets
      .filter((target) => scene.paneById.has(target.paneId))
      .map((target) => [target.paneId, target] as const),
  );
}

function resizeColumnsForPaneTargets(
  engine: WorkspaceLikeLayoutEngine,
  scene: WorkspaceScene,
  targetByPaneId: ReadonlyMap<PaneId, PaneSizeTarget>,
): void {
  const widthBySlot = paneTargetWidthBySlot(scene, targetByPaneId);
  const resizedSlots = new Set<number>();
  for (const column of scene.columns) {
    const slotIndex = columnSlotIndex(column);
    const widthPx = widthBySlot.get(slotIndex);
    if (widthPx === undefined || resizedSlots.has(slotIndex)) {
      continue;
    }
    engine.resizeColumn(column.columnId, { unit: "px", value: widthPx });
    resizedSlots.add(slotIndex);
  }
}

function paneTargetWidthBySlot(
  scene: WorkspaceScene,
  targetByPaneId: ReadonlyMap<PaneId, PaneSizeTarget>,
): Map<number, number> {
  const widthBySlot = new Map<number, number>();
  for (const column of scene.columns) {
    const widths = column.cells
      .flatMap((cell) =>
        cell.paneId ? [targetByPaneId.get(cell.paneId)?.widthPx] : [],
      )
      .filter((width): width is number => width !== undefined);
    if (widths.length === 0) {
      continue;
    }
    const slotIndex = columnSlotIndex(column);
    widthBySlot.set(
      slotIndex,
      Math.max(widthBySlot.get(slotIndex) ?? minimumColumnWidth, ...widths),
    );
  }
  return widthBySlot;
}

function measureMountedPanes(
  workspace: HTMLElement,
  maximum: PaneSize,
): Map<PaneId, PaneSize> {
  const paneById = new Map(
    [...workspace.querySelectorAll<HTMLElement>("[data-onirigiri-pane-id]")]
      .map((pane) => [pane.dataset.onirigiriPaneId, pane] as const)
      .filter((entry): entry is [PaneId, HTMLElement] => Boolean(entry[0])),
  );
  const host = workspace.ownerDocument.createElement("div");
  host.ariaHidden = "true";
  host.inert = true;
  Object.assign(host.style, {
    contain: "none",
    height: "max-content",
    inset: "0 auto auto 0",
    overflow: "visible",
    pointerEvents: "none",
    position: "absolute",
    visibility: "hidden",
    width: "max-content",
    zIndex: "-1",
  });
  workspace.append(host);

  const measurements = new Map<PaneId, PaneSize>();
  try {
    for (const [paneId, pane] of paneById) {
      const measured = measurePaneClone(host, pane, maximum);
      if (measured) {
        measurements.set(paneId, measured);
      }
    }
  } finally {
    host.remove();
  }
  return measurements;
}

function measurePaneClone(
  host: HTMLElement,
  source: HTMLElement,
  maximum: PaneSize,
): PaneSize | null {
  const clone = source.cloneNode(true) as HTMLElement;
  preparePaneClone(clone, maximum.widthPx);
  host.append(clone);

  const intrinsicWidth = measuredDimension(
    clone.scrollWidth,
    clone.getBoundingClientRect().width,
  );
  const widthPx = clampPaneSize(
    intrinsicWidth,
    minimumColumnWidth,
    maximum.widthPx,
  );
  clone.style.width = `${widthPx}px`;
  clone.style.maxWidth = `${widthPx}px`;
  const intrinsicHeight = measuredDimension(
    clone.scrollHeight,
    clone.getBoundingClientRect().height,
  );
  clone.remove();
  if (intrinsicWidth <= 0 && intrinsicHeight <= 0) {
    return null;
  }
  return {
    heightPx: clampPaneSize(
      intrinsicHeight,
      minimumPaneHeightPx,
      maximum.heightPx,
    ),
    widthPx,
  };
}

function preparePaneClone(clone: HTMLElement, maximumWidthPx: number): void {
  clone.ariaHidden = "true";
  clone.dataset.focused = "false";
  clone.dataset.frozen = "false";
  clone.dataset.moving = "false";
  clone.dataset.visible = "true";
  clone.inert = true;
  Object.assign(clone.style, {
    contain: "none",
    containerType: "normal",
    height: "max-content",
    inset: "auto",
    maxHeight: "none",
    maxWidth: `${maximumWidthPx}px`,
    minHeight: "0",
    opacity: "1",
    overflow: "visible",
    position: "relative",
    transform: "none",
    visibility: "hidden",
    width: "max-content",
  });

  const content = clone.querySelector<HTMLElement>(".onirigiri-pane__content");
  if (content) {
    content.dataset.runtimeState = "live";
    Object.assign(content.style, {
      flex: "0 0 auto",
      height: "auto",
      overflow: "visible",
    });
  }
  const contentSurface = clone.querySelector<HTMLElement>(
    ".onirigiri-pane__content-surface",
  );
  if (contentSurface) {
    Object.assign(contentSurface.style, {
      height: "auto",
      overflow: "visible",
      position: "relative",
      transform: "none",
    });
  }
  const liveSurface = clone.querySelector<HTMLElement>(
    ".onirigiri-pane__live-surface",
  );
  if (liveSurface) {
    Object.assign(liveSurface.style, {
      height: "auto",
      position: "relative",
      transform: "none",
      width: "100%",
    });
  }
  const liveContent = clone.querySelector<HTMLElement>(
    ".onirigiri-pane__live-content",
  );
  if (liveContent) {
    liveContent.ariaHidden = "false";
    liveContent.inert = false;
    Object.assign(liveContent.style, {
      contentVisibility: "visible",
      height: "auto",
      overflow: "visible",
      visibility: "hidden",
    });
  }
  clone.querySelector(".onirigiri-pane__frozen-content")?.remove();
  for (const element of clone.querySelectorAll<HTMLElement>("[id]")) {
    element.removeAttribute("id");
  }
  for (const label of clone.querySelectorAll<HTMLLabelElement>("label[for]")) {
    label.removeAttribute("for");
  }
}

function measuredDimension(scrollSize: number, boundingSize: number): number {
  return Math.ceil(Math.max(finiteSize(scrollSize), finiteSize(boundingSize)));
}

function clampPaneSize(
  value: number | undefined,
  minimum: number,
  maximum: number,
): number {
  const size = finiteSize(value);
  return Math.min(maximum, Math.max(minimum, Math.round(size || minimum)));
}

function finiteSize(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
