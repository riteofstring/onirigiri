import type { WorkspaceLayoutSnapshot } from "../src/state/layout-store";
import type { PaneRenderItem } from "../src/types";

export const viewport = { height: 600, width: 800, x: 0, y: 0 };

export function renderItem(
  overrides: Partial<PaneRenderItem> = {},
): PaneRenderItem {
  return {
    focused: true,
    height: 300,
    maximized: false,
    moving: false,
    opacity: 1,
    paneId: "pane",
    presentationMode: "normal",
    resizing: false,
    runtimeState: "live",
    scale: 1,
    surfaceId: "surface",
    surfaceKind: "test",
    visible: true,
    width: 400,
    x: 0,
    y: 0,
    z: 2,
    ...overrides,
  };
}

export function snapshot(
  overrides: Partial<WorkspaceLayoutSnapshot> = {},
): WorkspaceLayoutSnapshot {
  return {
    cursor: { column: 0, row: 0, split: 0 },
    focusAnchor: "start",
    focusedPaneId: "pane",
    horizontalAnchorOffset: 0,
    layoutChangeKind: "initial",
    layoutMutationId: 0,
    layoutRevision: 0,
    maximizedPaneId: null,
    overviewFollowOffsetX: 0,
    overviewFollowOffsetY: 0,
    overviewPanX: 0,
    overviewPanY: 0,
    overviewProgress: 0,
    overviewZoom: 1,
    paneRearrangementRevision: 0,
    paneRearrangementSelection: "pane",
    presentationMode: "normal",
    revision: 0,
    scrollColumn: 0,
    scrollRow: 0,
    selectedGroupColumnId: null,
    targetHorizontalAnchorOffset: 0,
    targetScrollColumn: 0,
    targetScrollRow: 0,
    targetVerticalAnchorOffset: 0,
    verticalAnchorOffset: 0,
    ...overrides,
  };
}

export function paneHostWithNativeContent(): {
  content: HTMLElement;
  host: HTMLElement;
  liveSurface: HTMLElement;
  surface: HTMLElement;
} {
  const host = document.createElement("section");
  const content = document.createElement("div");
  const contentSurface = document.createElement("div");
  const liveSurface = document.createElement("div");
  const surface = document.createElement("div");
  const liveContent = document.createElement("div");
  content.className = "onirigiri-pane__content";
  contentSurface.className = "onirigiri-pane__content-surface";
  liveSurface.className = "onirigiri-pane__live-surface";
  surface.className = "onirigiri-pane__picture-surface";
  liveContent.className = "onirigiri-pane__live-content";
  liveSurface.append(liveContent);
  contentSurface.append(liveSurface, surface);
  content.append(contentSurface);
  host.append(content);
  return { content, host, liveSurface, surface };
}

export function setContentViewportSize(
  content: HTMLElement,
  host: HTMLElement,
  titlebarHeight: number,
): void {
  Object.defineProperties(content, {
    clientHeight: {
      configurable: true,
      get: () =>
        Math.max(1, Number.parseFloat(host.style.height) - titlebarHeight),
    },
    clientWidth: {
      configurable: true,
      get: () => Math.max(1, Number.parseFloat(host.style.width)),
    },
  });
}
