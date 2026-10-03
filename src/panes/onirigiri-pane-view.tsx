import {
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import type { WorkspaceLayoutStore } from "../state/layout-store.js";
import {
  OnirigiriPaneTitlebar,
  type OnirigiriPaneTitlebarProps,
} from "./onirigiri-pane-titlebar.js";
import { OnirigiriPaneContent } from "./onirigiri-pane-content.js";
import type { PanePresentationEngine } from "../presentation/pane-presentation-engine.js";
import {
  resolveOnirigiriSlotProps,
  useOnirigiriStyling,
} from "../styles/onirigiri-styling.js";
import type { OnirigiriWorkspaceProps } from "../workspace/onirigiri-workspace-types.js";
import type { PanePictures } from "../pictures/pane-pictures.js";
import { minimumPaneHeightPx } from "./pane-resize-geometry.js";
import { PaneDefaultsContext } from "./pane-content-layout.js";
import { paneCellSizingForPane } from "../layout/pane-cell-sizing.js";
import { resolvePaneDefaults } from "../layout/pane-defaults.js";
import type { PaneResizeStart } from "../input/pane-resize-interactions.js";
import {
  defaultPaneResizeEdges,
  type PaneId,
  type PaneRenderItem,
  type WorkspacePane,
  type WorkspaceScene,
} from "../types.js";

export interface OnirigiriPaneViewProps extends Omit<
  OnirigiriPaneTitlebarProps,
  "controlsAvailable" | "maximized"
> {
  aboveItem: PaneRenderItem | null;
  abovePane: WorkspacePane | null;
  adjacentItem: PaneRenderItem | null;
  adjacentPane: WorkspacePane | null;
  beginResize: PaneResizeStart;
  compactLayout: boolean;
  groupSelected: boolean;
  item: PaneRenderItem;
  presentation: PanePresentationEngine;
  pictures: PanePictures;
  renderPane: OnirigiriWorkspaceProps["renderPane"];
  renderPanePlaceholder?: OnirigiriWorkspaceProps["renderPanePlaceholder"];
  rowHeight: number;
}

export const OnirigiriPaneView = memo(function OnirigiriPaneView({
  aboveItem,
  abovePane,
  adjacentItem,
  adjacentPane,
  beginResize,
  closePane,
  compactLayout,
  groupSelected,
  item,
  pane,
  presentation,
  pictures,
  renderPane,
  renderPanePlaceholder,
  rowHeight,
  showControls,
  store,
}: OnirigiriPaneViewProps) {
  const paneHostRef = useRef<HTMLElement | null>(null);
  const latestItemRef = useRef(item);
  latestItemRef.current = item;
  const latestCompactLayoutRef = useRef(compactLayout);
  latestCompactLayoutRef.current = compactLayout;
  const subscribeToPicture = useCallback(
    (listener: () => void) => pictures.subscribe(pane.paneId, listener),
    [pictures, pane.paneId],
  );
  const getPicture = useCallback(
    () => pictures.get(pane.paneId),
    [pictures, pane],
  );
  const picture = useSyncExternalStore(
    subscribeToPicture,
    getPicture,
    getPicture,
  );
  useLayoutEffect(() => {
    const host = paneHostRef.current;
    if (!host) {
      return;
    }
    return presentation.registerPaneHost(
      pane.paneId,
      host,
      latestItemRef.current,
      latestCompactLayoutRef.current,
    );
  }, [pane.paneId, presentation]);
  useLayoutEffect(() => {
    presentation.updatePaneHostBoundary(pane.paneId, item, compactLayout);
  }, [compactLayout, item, pane.paneId, presentation]);
  const styling = useOnirigiriStyling();
  const paneSlot = resolveOnirigiriSlotProps(styling, "pane", "onirigiri-pane");
  return (
    <section
      aria-label={
        groupSelected
          ? `${pane.title}, selected rearrangement group`
          : pane.title
      }
      className={paneSlot.className}
      data-onirigiri-column-id={pane.columnId}
      data-onirigiri-pane-id={pane.paneId}
      data-onirigiri-picture-ready={String(picture !== null)}
      data-onirigiri-slot="pane"
      data-onirigiri-surface-kind={pane.surfaceKind}
      data-group-selected={String(groupSelected)}
      data-tone={pane.tone}
      ref={paneHostRef}
      style={paneSlot.style}
      tabIndex={-1}
    >
      <OnirigiriPaneTitlebar
        controlsAvailable={showControls && item.presentationMode === "normal"}
        maximized={item.maximized}
        pane={pane}
        showControls={showControls}
        closePane={closePane}
        store={store}
      />
      <OnirigiriPaneContent
        focused={item.focused}
        maximized={item.maximized}
        picture={picture}
        pictures={pictures}
        pane={pane}
        placeholderOnly={item.placeholderOnly === true}
        presentationMode={item.presentationMode}
        renderPane={renderPane}
        renderPanePlaceholder={renderPanePlaceholder}
        runtimeState={item.runtimeState}
        visible={item.visible}
      />
      {item.visible ? (
        <PaneResizeHandles
          aboveItem={aboveItem}
          abovePane={abovePane}
          adjacentItem={adjacentItem}
          adjacentPane={adjacentPane}
          beginResize={beginResize}
          compactLayout={compactLayout}
          item={item}
          pane={pane}
          rowHeight={rowHeight}
          store={store}
        />
      ) : null}
    </section>
  );
}, paneViewIsUnchanged);

function paneViewIsUnchanged(
  previous: Readonly<OnirigiriPaneViewProps>,
  next: Readonly<OnirigiriPaneViewProps>,
): boolean {
  return (
    paneViewFieldsAreUnchanged(previous, next) ||
    parkedPaneViewIsUnchanged(previous, next) ||
    frozenMovingPaneViewIsUnchanged(previous, next) ||
    frozenOverviewExitPaneViewIsUnchanged(previous, next)
  );
}

type PaneItemPropKey = "aboveItem" | "adjacentItem" | "item";

const paneItemPropKeys: ReadonlySet<string> = new Set<PaneItemPropKey>([
  "aboveItem",
  "adjacentItem",
  "item",
]);

function paneViewFieldsAreUnchanged(
  previous: Readonly<OnirigiriPaneViewProps>,
  next: Readonly<OnirigiriPaneViewProps>,
): boolean {
  for (const field in previous) {
    const key = field as keyof OnirigiriPaneViewProps;
    if (!(key in next)) return false;
    if (paneItemPropKeys.has(key)) {
      const itemKey = key as PaneItemPropKey;
      if (!paneItemFieldsAreUnchanged(previous[itemKey], next[itemKey]))
        return false;
    } else if (previous[key] !== next[key]) return false;
  }
  for (const key in next) if (!(key in previous)) return false;
  return true;
}

function paneItemFieldsAreUnchanged(
  previous: PaneRenderItem | null,
  next: PaneRenderItem | null,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  for (const field in previous) {
    const key = field as keyof PaneRenderItem;
    if (!(key in next) || previous[key] !== next[key]) return false;
  }
  for (const key in next) if (!(key in previous)) return false;
  return true;
}

function parkedPaneViewIsUnchanged(
  previous: Readonly<OnirigiriPaneViewProps>,
  next: Readonly<OnirigiriPaneViewProps>,
): boolean {
  return (
    !previous.item.visible &&
    previous.item === next.item &&
    previous.compactLayout === next.compactLayout &&
    previous.groupSelected === next.groupSelected &&
    previous.pane === next.pane &&
    previous.pictures === next.pictures &&
    previous.renderPane === next.renderPane &&
    previous.showControls === next.showControls
  );
}

function frozenMovingPaneViewIsUnchanged(
  previous: Readonly<OnirigiriPaneViewProps>,
  next: Readonly<OnirigiriPaneViewProps>,
): boolean {
  return (
    previous.item === next.item &&
    frozenPaneViewStablePropsAreUnchanged(previous, next) &&
    isUnfocusedFrozenMovingPane(previous.item)
  );
}

function isUnfocusedFrozenMovingPane(item: Readonly<PaneRenderItem>): boolean {
  return item.runtimeState === "frozen" && item.moving && !item.focused;
}

function frozenOverviewExitPaneViewIsUnchanged(
  previous: Readonly<OnirigiriPaneViewProps>,
  next: Readonly<OnirigiriPaneViewProps>,
): boolean {
  return (
    frozenPaneViewStablePropsAreUnchanged(previous, next) &&
    isFrozenOverviewExitItemTransition(previous.item, next.item)
  );
}

function frozenPaneViewStablePropsAreUnchanged(
  previous: Readonly<OnirigiriPaneViewProps>,
  next: Readonly<OnirigiriPaneViewProps>,
): boolean {
  return frozenPaneViewStablePropKeys.every(
    (key) => previous[key] === next[key],
  );
}

const frozenPaneViewStablePropKeys = [
  "closePane",
  "compactLayout",
  "groupSelected",
  "pane",
  "presentation",
  "pictures",
  "renderPane",
  "showControls",
  "store",
] as const satisfies readonly (keyof OnirigiriPaneViewProps)[];

function isFrozenOverviewExitItemTransition(
  previous: Readonly<PaneRenderItem>,
  next: Readonly<PaneRenderItem>,
): boolean {
  return (
    frozenOverviewExitItemIdentityIsStable(previous, next) &&
    isUnfocusedFrozenOverviewExit(previous, next) &&
    isMovingOutOfOverview(previous, next)
  );
}

function frozenOverviewExitItemIdentityIsStable(
  previous: Readonly<PaneRenderItem>,
  next: Readonly<PaneRenderItem>,
): boolean {
  return (
    previous.paneId === next.paneId &&
    previous.maximized === next.maximized &&
    previous.placeholderOnly === next.placeholderOnly &&
    previous.visible === next.visible
  );
}

function isUnfocusedFrozenOverviewExit(
  previous: Readonly<PaneRenderItem>,
  next: Readonly<PaneRenderItem>,
): boolean {
  return (
    previous.runtimeState === "frozen" &&
    next.runtimeState === "frozen" &&
    !previous.focused &&
    !next.focused
  );
}

function isMovingOutOfOverview(
  previous: Readonly<PaneRenderItem>,
  next: Readonly<PaneRenderItem>,
): boolean {
  return (
    previous.presentationMode === "overview" &&
    next.presentationMode === "normal" &&
    !previous.moving &&
    next.moving
  );
}

type PaneResizeHandleProps = Pick<
  OnirigiriPaneViewProps,
  | "aboveItem"
  | "abovePane"
  | "adjacentItem"
  | "adjacentPane"
  | "beginResize"
  | "item"
  | "pane"
  | "rowHeight"
  | "store"
>;

const paneResizeHandleOrder = ["right", "bottom", "left", "top"] as const;

function PaneResizeHandles({
  compactLayout,
  ...props
}: PaneResizeHandleProps & Pick<OnirigiriPaneViewProps, "compactLayout">) {
  const configuration = useContext(PaneDefaultsContext);
  if (paneResizeHandlesHidden(props.item, compactLayout)) {
    return null;
  }
  const edges = new Set(
    resolvePaneDefaults(props.pane, configuration).resizeEdges ??
      defaultPaneResizeEdges,
  );
  return paneResizeHandleOrder
    .filter((edge) => edges.has(edge))
    .map((edge) =>
      edge === "left" || edge === "right" ? (
        <PaneColumnResizeHandle {...props} edge={edge} key={edge} />
      ) : (
        <PaneRowResizeHandle {...props} edge={edge} key={edge} />
      ),
    );
}

function paneResizeHandlesHidden(
  item: PaneRenderItem,
  compactLayout: boolean,
): boolean {
  return (
    compactLayout ||
    (item.moving && !item.focused) ||
    item.presentationMode !== "normal" ||
    item.maximized
  );
}

function PaneColumnResizeHandle({
  beginResize,
  edge,
  item,
  pane,
  store,
}: PaneResizeHandleProps & { edge: "left" | "right" }) {
  const columnResizeSlot = resolveOnirigiriSlotProps(
    useOnirigiriStyling(),
    "pane-resize-column",
    edge === "left"
      ? "onirigiri-pane__resize onirigiri-pane__resize--column onirigiri-pane__resize--left"
      : "onirigiri-pane__resize onirigiri-pane__resize--column",
  );
  return (
    <button
      aria-label={
        edge === "left"
          ? `Resize ${pane.title} width from the left edge`
          : `Resize ${pane.title} width`
      }
      aria-keyshortcuts="ArrowLeft ArrowRight Enter Space"
      className={columnResizeSlot.className}
      data-onirigiri-pane-control="true"
      data-onirigiri-slot="pane-resize-column"
      data-resize-edge={edge}
      onDoubleClick={(event) => {
        event.stopPropagation();
        store.focusPane(pane.paneId);
        store.resetFocusedColumnWidth();
        store.reanchorFocusedPane();
      }}
      onKeyDown={(event) => handleColumnResizeKeyDown(event, item, edge, store)}
      onPointerDown={(event) => beginResize(event, item, edge)}
      style={columnResizeSlot.style}
      type="button"
    />
  );
}

function PaneRowResizeHandle(
  props: PaneResizeHandleProps & { edge: "bottom" | "top" },
) {
  const { beginResize, edge, item, pane, rowHeight, store } = props;
  const rowResizeSlot = resolveOnirigiriSlotProps(
    useOnirigiriStyling(),
    "pane-resize-row",
    edge === "top"
      ? "onirigiri-pane__resize onirigiri-pane__resize--row onirigiri-pane__resize--top"
      : "onirigiri-pane__resize onirigiri-pane__resize--row",
  );
  const { label, neighbourItem, split } = paneRowResizeTarget(props);
  return (
    <button
      aria-label={label}
      aria-keyshortcuts="ArrowUp ArrowDown Enter Space"
      className={rowResizeSlot.className}
      data-onirigiri-pane-control="true"
      data-onirigiri-slot="pane-resize-row"
      data-resize-edge={edge}
      data-resize-kind={split ? "split" : "row"}
      onDoubleClick={(event) => {
        event.stopPropagation();
        resetPaneRowResize(store, pane.paneId, split);
      }}
      onKeyDown={(event) =>
        handleRowResizeKeyDown(event, { edge, item, rowHeight, split }, store)
      }
      onPointerDown={(event) =>
        beginResize(event, item, edge, neighbourItem ?? undefined)
      }
      style={rowResizeSlot.style}
      type="button"
    />
  );
}

function paneRowResizeTarget({
  aboveItem,
  abovePane,
  adjacentItem,
  adjacentPane,
  edge,
  item,
  pane,
}: PaneResizeHandleProps & { edge: "bottom" | "top" }): {
  label: string;
  neighbourItem: PaneRenderItem | null;
  split: PaneSplitItems | null;
} {
  if (edge === "bottom") {
    return {
      label: adjacentPane
        ? `Resize split between ${pane.title} and ${adjacentPane.title}`
        : `Resize row containing ${pane.title}`,
      neighbourItem: adjacentItem,
      split: adjacentItem ? { lower: adjacentItem, upper: item } : null,
    };
  }
  return {
    label: abovePane
      ? `Resize split between ${abovePane.title} and ${pane.title}`
      : `Resize row containing ${pane.title} from the top edge`,
    neighbourItem: aboveItem,
    split: aboveItem ? { lower: item, upper: aboveItem } : null,
  };
}

interface PaneSplitItems {
  lower: PaneRenderItem;
  upper: PaneRenderItem;
}

function resetPaneRowResize(
  store: WorkspaceLayoutStore,
  paneId: PaneId,
  split: PaneSplitItems | null,
): void {
  if (!split) {
    store.resizePaneRow(paneId, null);
    store.reanchorFocusedPane();
    return;
  }
  const scene = store.toScene();
  const pairWeight =
    paneWeight(scene, split.upper.paneId) +
    paneWeight(scene, split.lower.paneId);
  store.resizePaneSplit(
    split.upper.paneId,
    split.lower.paneId,
    pairWeight / 2,
    pairWeight / 2,
  );
  store.reanchorFocusedPane();
}

function handleColumnResizeKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  item: PaneRenderItem,
  edge: "left" | "right",
  store: WorkspaceLayoutStore,
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    store.focusPane(item.paneId);
    store.resetFocusedColumnWidth();
    store.reanchorFocusedPane();
    return;
  }
  const direction =
    event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (direction === 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  store.focusPane(item.paneId);
  const growth =
    (edge === "left" ? -direction : direction) * keyboardResizeStep(event);
  store.resizePaneColumn(
    item.paneId,
    { unit: "px", value: Math.max(180, item.width + growth) },
    edge === "left" ? "end" : "start",
  );
  store.reanchorFocusedPane();
}

interface PaneRowResizeTarget {
  edge: "bottom" | "top";
  item: PaneRenderItem;
  rowHeight: number;
  split: PaneSplitItems | null;
}

function handleRowResizeKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  { edge, item, rowHeight, split }: PaneRowResizeTarget,
  store: WorkspaceLayoutStore,
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    store.focusPane(item.paneId);
    resetPaneRowResize(store, item.paneId, split);
    return;
  }
  const direction =
    event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (direction === 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  store.focusPane(item.paneId);
  const delta = direction * keyboardResizeStep(event);
  if (!split) {
    store.resizePaneRow(
      item.paneId,
      Math.max(
        minimumPaneHeightPx,
        rowHeight + (edge === "top" ? -delta : delta),
      ),
      edge === "top" ? "end" : "start",
    );
    store.reanchorFocusedPane();
    return;
  }
  resizePaneSplitFromKeyboard(store, split.upper, split.lower, delta);
  store.reanchorFocusedPane();
}

function resizePaneSplitFromKeyboard(
  store: WorkspaceLayoutStore,
  item: PaneRenderItem,
  adjacentItem: PaneRenderItem,
  delta: number,
): void {
  const pairHeight = item.height + adjacentItem.height;
  const minimumSplitHeight = Math.min(
    minimumPaneHeightPx,
    Math.max(1, Math.floor((pairHeight - 1) / 2)),
  );
  const upperHeight = Math.min(
    pairHeight - minimumSplitHeight,
    Math.max(minimumSplitHeight, item.height + delta),
  );
  const scene = store.toScene();
  const pairWeight = Math.max(
    0.2,
    paneWeight(scene, item.paneId) + paneWeight(scene, adjacentItem.paneId),
  );
  const upperWeight = (pairWeight * upperHeight) / Math.max(1, pairHeight);
  store.resizePaneSplit(
    item.paneId,
    adjacentItem.paneId,
    Math.max(0.1, upperWeight),
    Math.max(0.1, pairWeight - upperWeight),
  );
}

function keyboardResizeStep(event: KeyboardEvent<HTMLButtonElement>): number {
  return event.shiftKey ? 64 : 16;
}

function paneWeight(scene: WorkspaceScene, paneId: PaneId): number {
  return paneCellSizingForPane(scene, paneId)?.weight ?? 1;
}
