import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import type { WorkspaceLayoutStore } from "../state/layout-store";
import {
  OnirigiriPaneTitlebar,
  type OnirigiriPaneTitlebarProps,
} from "./onirigiri-pane-titlebar";
import { OnirigiriPaneContent } from "./onirigiri-pane-content";
import type { PanePresentationEngine } from "../presentation/pane-presentation-engine";
import {
  resolveOnirigiriSlotProps,
  useOnirigiriStyling,
} from "../styles/onirigiri-styling";
import type { OnirigiriWorkspaceProps } from "../workspace/onirigiri-workspace-types";
import type { PanePictures } from "../pictures/pane-pictures";
import { minimumPaneHeightPx } from "./pane-resize-geometry";
import { paneCellSizingForPane } from "../layout/pane-cell-sizing";
import type {
  PaneResizeStart,
  ResizeAxis,
} from "../input/pane-resize-interactions";
import type {
  PaneId,
  PaneRenderItem,
  WorkspacePane,
  WorkspaceScene,
} from "../types";

export interface OnirigiriPaneViewProps extends Omit<
  OnirigiriPaneTitlebarProps,
  "controlsAvailable" | "maximized"
> {
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

function paneViewFieldsAreUnchanged(
  previous: Readonly<OnirigiriPaneViewProps>,
  next: Readonly<OnirigiriPaneViewProps>,
): boolean {
  for (const field in previous) {
    const key = field as keyof OnirigiriPaneViewProps;
    if (!(key in next)) return false;
    if (key === "item" || key === "adjacentItem") {
      if (!paneItemFieldsAreUnchanged(previous[key], next[key])) return false;
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

function PaneResizeHandles({
  adjacentItem,
  adjacentPane,
  beginResize,
  compactLayout,
  item,
  pane,
  rowHeight,
  store,
}: Pick<
  OnirigiriPaneViewProps,
  | "adjacentItem"
  | "adjacentPane"
  | "beginResize"
  | "compactLayout"
  | "item"
  | "pane"
  | "rowHeight"
  | "store"
>) {
  const columnResizeSlot = resolveOnirigiriSlotProps(
    useOnirigiriStyling(),
    "pane-resize-column",
    "onirigiri-pane__resize onirigiri-pane__resize--column",
  );
  if (
    compactLayout ||
    (item.moving && !item.focused) ||
    item.presentationMode !== "normal" ||
    item.maximized
  ) {
    return null;
  }
  return (
    <>
      <button
        aria-label={`Resize ${pane.title} width`}
        aria-keyshortcuts="ArrowLeft ArrowRight Enter Space"
        className={columnResizeSlot.className}
        data-onirigiri-pane-control="true"
        data-onirigiri-slot="pane-resize-column"
        onDoubleClick={(event) => {
          event.stopPropagation();
          store.focusPane(pane.paneId);
          store.resetFocusedColumnWidth();
          store.reanchorFocusedPane();
        }}
        onKeyDown={(event) => handleColumnResizeKeyDown(event, item, store)}
        onPointerDown={(event) => beginResize(event, item, "column")}
        style={columnResizeSlot.style}
        type="button"
      />
      <PaneRowResizeHandle
        adjacentItem={adjacentItem}
        adjacentPane={adjacentPane}
        beginResize={beginResize}
        item={item}
        pane={pane}
        rowHeight={rowHeight}
        store={store}
      />
    </>
  );
}

function PaneRowResizeHandle({
  adjacentItem,
  adjacentPane,
  beginResize,
  item,
  pane,
  rowHeight,
  store,
}: Pick<
  OnirigiriPaneViewProps,
  | "adjacentItem"
  | "adjacentPane"
  | "beginResize"
  | "item"
  | "pane"
  | "rowHeight"
  | "store"
>) {
  const rowResizeSlot = resolveOnirigiriSlotProps(
    useOnirigiriStyling(),
    "pane-resize-row",
    "onirigiri-pane__resize onirigiri-pane__resize--row",
  );
  const resizeKind: Extract<ResizeAxis, "row" | "split"> = adjacentItem
    ? "split"
    : "row";
  const label = adjacentPane
    ? `Resize split between ${pane.title} and ${adjacentPane.title}`
    : `Resize row containing ${pane.title}`;
  return (
    <button
      aria-label={label}
      aria-keyshortcuts="ArrowUp ArrowDown Enter Space"
      className={rowResizeSlot.className}
      data-onirigiri-pane-control="true"
      data-onirigiri-slot="pane-resize-row"
      data-resize-kind={resizeKind}
      onDoubleClick={(event) => {
        event.stopPropagation();
        resetPaneRowResize(store, pane.paneId, adjacentItem);
      }}
      onKeyDown={(event) =>
        handleRowResizeKeyDown(event, item, adjacentItem, rowHeight, store)
      }
      onPointerDown={(event) =>
        beginResize(event, item, resizeKind, adjacentItem ?? undefined)
      }
      style={rowResizeSlot.style}
      type="button"
    />
  );
}

function resetPaneRowResize(
  store: WorkspaceLayoutStore,
  paneId: PaneId,
  adjacentItem: PaneRenderItem | null,
): void {
  if (!adjacentItem) {
    store.resizePaneRow(paneId, null);
    store.reanchorFocusedPane();
    return;
  }
  const scene = store.toScene();
  const pairWeight =
    paneWeight(scene, paneId) + paneWeight(scene, adjacentItem.paneId);
  store.resizePaneSplit(
    paneId,
    adjacentItem.paneId,
    pairWeight / 2,
    pairWeight / 2,
  );
  store.reanchorFocusedPane();
}

function handleColumnResizeKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  item: PaneRenderItem,
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
  store.resizePaneColumn(item.paneId, {
    unit: "px",
    value: Math.max(180, item.width + direction * keyboardResizeStep(event)),
  });
  store.reanchorFocusedPane();
}

function handleRowResizeKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  item: PaneRenderItem,
  adjacentItem: PaneRenderItem | null,
  rowHeight: number,
  store: WorkspaceLayoutStore,
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    store.focusPane(item.paneId);
    resetPaneRowResize(store, item.paneId, adjacentItem);
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
  if (!adjacentItem) {
    store.resizePaneRow(
      item.paneId,
      Math.max(minimumPaneHeightPx, rowHeight + delta),
    );
    store.reanchorFocusedPane();
    return;
  }
  resizePaneSplitFromKeyboard(store, item, adjacentItem, delta);
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
