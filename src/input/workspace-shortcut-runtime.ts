import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { WorkspaceLayoutStore } from "../state/layout-store";
import type { PaneId, Rect } from "../types";
import { workspaceGridCursorAnnouncement } from "../workspace/workspace-grid-cursor";
import type {
  OnirigiriShortcutAction,
  OnirigiriShortcutScope,
} from "./workspace-shortcuts";

export type OnirigiriShortcutKeyboardEvent =
  ReactKeyboardEvent<HTMLDivElement> | globalThis.KeyboardEvent;

interface ApplicationShortcutRegistry {
  activeToken: symbol | null;
  tokens: Set<symbol>;
}

interface ShortcutActionContext {
  store: WorkspaceLayoutStore;
  viewport: Rect;
}

const applicationShortcutRegistries = new WeakMap<
  Document,
  ApplicationShortcutRegistry
>();

export function activateApplicationShortcutWorkspaceIfEnabled(
  shortcutScope: OnirigiriShortcutScope,
  workspace: HTMLElement | null,
  token: symbol,
): void {
  if (shortcutScope === "application" && workspace) {
    activateApplicationShortcutWorkspace(workspace.ownerDocument, token);
  }
}

function eventTargetAcceptsText(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select") !== null)
  );
}

export function workspaceChromeFocusedPaneId(
  workspace: HTMLElement | null,
): PaneId | null {
  const activeElement = workspace?.ownerDocument.activeElement;
  if (
    !(activeElement instanceof Element) ||
    !activeElement.matches(
      ".onirigiri-pane, .onirigiri-pane__titlebar, .onirigiri-pane__titlebar *, .onirigiri-pane__resize",
    ) ||
    activeElement.closest(".onirigiri-workspace") !== workspace
  ) {
    return null;
  }
  return (
    activeElement.closest<HTMLElement>(".onirigiri-pane")?.dataset
      .onirigiriPaneId ?? null
  );
}

function eventTargetIsInsideModal(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("dialog[open], [role='dialog'][aria-modal='true']") !== null
  );
}

export function eventTargetIsInsideAnotherWorkspace(
  target: EventTarget | null,
  workspace: HTMLElement,
): boolean {
  const targetWorkspace =
    target instanceof Element
      ? target.closest<HTMLElement>(".onirigiri-workspace")
      : null;
  return targetWorkspace !== null && targetWorkspace !== workspace;
}

function shortcutEventIsComposing(
  event: OnirigiriShortcutKeyboardEvent,
): boolean {
  return "nativeEvent" in event
    ? event.nativeEvent.isComposing
    : event.isComposing;
}

export function shortcutEventIsIgnored(
  event: OnirigiriShortcutKeyboardEvent,
): boolean {
  return (
    event.defaultPrevented ||
    shortcutEventIsComposing(event) ||
    eventTargetAcceptsText(event.target) ||
    eventTargetIsInsideModal(event.target)
  );
}

export function escapePresentationState(store: WorkspaceLayoutStore): boolean {
  const snapshot = store.getSnapshot();
  if (snapshot.paneRearrangementSelection === "group") {
    return store.clearPaneRearrangementGroup();
  }
  if (snapshot.presentationMode === "overview") {
    store.toggleOverviewMode();
    return true;
  }
  if (snapshot.maximizedPaneId) {
    store.togglePaneMaximized(snapshot.maximizedPaneId);
    return true;
  }
  return false;
}

export function registerApplicationShortcutWorkspace(
  ownerDocument: Document,
  token: symbol,
): () => void {
  let registry = applicationShortcutRegistries.get(ownerDocument);
  if (!registry) {
    registry = { activeToken: null, tokens: new Set() };
    applicationShortcutRegistries.set(ownerDocument, registry);
  }
  registry.tokens.add(token);
  registry.activeToken ??= token;

  return () => {
    const currentRegistry = applicationShortcutRegistries.get(ownerDocument);
    if (!currentRegistry) {
      return;
    }
    currentRegistry.tokens.delete(token);
    if (currentRegistry.activeToken === token) {
      currentRegistry.activeToken =
        currentRegistry.tokens.values().next().value ?? null;
    }
    if (currentRegistry.tokens.size === 0) {
      applicationShortcutRegistries.delete(ownerDocument);
    }
  };
}

function activateApplicationShortcutWorkspace(
  ownerDocument: Document,
  token: symbol,
): void {
  const registry = applicationShortcutRegistries.get(ownerDocument);
  if (registry?.tokens.has(token)) {
    registry.activeToken = token;
  }
}

export function isActiveApplicationShortcutWorkspace(
  ownerDocument: Document,
  token: symbol,
): boolean {
  return (
    applicationShortcutRegistries.get(ownerDocument)?.activeToken === token
  );
}

const shortcutActionDispatchers: Record<
  OnirigiriShortcutAction,
  (context: ShortcutActionContext) => boolean
> = {
  createBlankSplitAbove: ({ store }) =>
    store.createFocusedReservedBlankSplit("up"),
  createBlankSplitBelow: ({ store }) =>
    store.createFocusedReservedBlankSplit("down"),
  focusDown: ({ store, viewport }) => store.moveFocus("down", viewport),
  focusFirstColumn: ({ store, viewport }) =>
    store.focusColumn("first", viewport),
  focusLastColumn: ({ store, viewport }) => store.focusColumn("last", viewport),
  focusLeft: ({ store, viewport }) => store.moveFocus("left", viewport),
  focusRight: ({ store, viewport }) => store.moveFocus("right", viewport),
  focusUp: ({ store, viewport }) => store.moveFocus("up", viewport),
  movePaneDown: ({ store }) => store.moveFocusedPane("down"),
  movePaneLeft: ({ store }) => store.moveFocusedPane("left"),
  movePaneRight: ({ store }) => store.moveFocusedPane("right"),
  movePaneUp: ({ store }) => store.moveFocusedPane("up"),
  moveGroupDown: ({ store }) => store.moveSelectedPaneGroup("down"),
  moveGroupLeft: ({ store }) => store.moveSelectedPaneGroup("left"),
  moveGroupRight: ({ store }) => store.moveSelectedPaneGroup("right"),
  moveGroupUp: ({ store }) => store.moveSelectedPaneGroup("up"),
  insertAsSplitLeft: ({ store }) => store.insertFocusedPaneAsSplit("left"),
  insertAsSplitRight: ({ store }) => store.insertFocusedPaneAsSplit("right"),
  removeBlankSplitAbove: ({ store }) =>
    store.removeFocusedReservedBlankSplit("up"),
  removeBlankSplitBelow: ({ store }) =>
    store.removeFocusedReservedBlankSplit("down"),
  returnHome: ({ store, viewport }) => store.returnHome(viewport),
  selectPaneGroup: ({ store }) => store.selectFocusedPaneGroup(),
  splitDown: ({ store }) => {
    return store.splitFocusedPane("down") !== null;
  },
  splitPlaneDown: ({ store }) => {
    return store.splitFocusedPaneToPlane("down") !== null;
  },
  splitPlaneUp: ({ store }) => {
    return store.splitFocusedPaneToPlane("up") !== null;
  },
  splitRight: ({ store }) => {
    return store.splitFocusedPane("right") !== null;
  },
  toggleOverview: ({ store }) => {
    store.toggleOverviewMode();
    return true;
  },
};

const paneMoveDirections: Partial<Record<OnirigiriShortcutAction, string>> = {
  movePaneDown: "down",
  movePaneLeft: "left",
  movePaneRight: "right",
  movePaneUp: "up",
};

const paneScopedShortcutActions = new Set<OnirigiriShortcutAction>([
  "createBlankSplitAbove",
  "createBlankSplitBelow",
  "insertAsSplitLeft",
  "insertAsSplitRight",
  "moveGroupDown",
  "moveGroupLeft",
  "moveGroupRight",
  "moveGroupUp",
  "movePaneDown",
  "movePaneLeft",
  "movePaneRight",
  "movePaneUp",
  "removeBlankSplitAbove",
  "removeBlankSplitBelow",
  "selectPaneGroup",
  "splitDown",
  "splitPlaneDown",
  "splitPlaneUp",
  "splitRight",
]);

const rearrangementAnnouncements: Partial<
  Record<OnirigiriShortcutAction, (paneTitle: string) => string>
> = {
  createBlankSplitAbove: () => "Created a reserved blank split.",
  createBlankSplitBelow: () => "Created a reserved blank split.",
  insertAsSplitLeft: (paneTitle) => `Inserted ${paneTitle} as a split.`,
  insertAsSplitRight: (paneTitle) => `Inserted ${paneTitle} as a split.`,
  moveGroupDown: (paneTitle) =>
    `Moved the split group containing ${paneTitle}.`,
  moveGroupLeft: (paneTitle) =>
    `Moved the split group containing ${paneTitle}.`,
  moveGroupRight: (paneTitle) =>
    `Moved the split group containing ${paneTitle}.`,
  moveGroupUp: (paneTitle) => `Moved the split group containing ${paneTitle}.`,
  removeBlankSplitAbove: () => "Removed the reserved blank split.",
  removeBlankSplitBelow: () => "Removed the reserved blank split.",
  selectPaneGroup: (paneTitle) =>
    `Selected the split group containing ${paneTitle}.`,
};

interface ShortcutDispatchResult {
  announcement: string | null;
  changed: boolean;
  pendingFocusPaneId: PaneId | null;
}

export function dispatchShortcutAction(
  action: OnirigiriShortcutAction,
  store: WorkspaceLayoutStore,
  viewport: Rect,
  workspace: HTMLElement | null,
): ShortcutDispatchResult {
  const chromePaneId = workspaceChromeFocusedPaneId(workspace);
  const changed = shortcutActionDispatchers[action]({ store, viewport });
  const focusedPaneId = store.focusedPaneId();
  const snapshot = store.getSnapshot();
  return {
    announcement: changed
      ? rearrangementAnnouncement(action, store, focusedPaneId)
      : !focusedPaneId && paneScopedShortcutActions.has(action)
        ? workspaceGridCursorAnnouncement(snapshot.cursor, null)
        : null,
    changed,
    pendingFocusPaneId:
      changed && chromePaneId && focusedPaneId && chromePaneId !== focusedPaneId
        ? focusedPaneId
        : null,
  };
}

function rearrangementAnnouncement(
  action: OnirigiriShortcutAction,
  store: WorkspaceLayoutStore,
  paneId: PaneId | null,
): string | null {
  if (!paneId) {
    return null;
  }
  const scene = store.toScene();
  const pane = scene.paneById.get(paneId);
  if (!pane) {
    return null;
  }
  const direction = paneMoveDirections[action];
  if (!direction) {
    return rearrangementAnnouncements[action]?.(pane.title) ?? null;
  }
  const column = scene.columns.find((candidate) =>
    candidate.cells.some((cell) => cell.paneId === paneId),
  );
  if (!column) {
    return null;
  }
  const cursor = store.getSnapshot().cursor;
  return `Moved ${pane.title} ${direction} to grid cell (${String(cursor.column)}, ${String(cursor.row)}), split ${String(cursor.split + 1)}.`;
}
