import type {
  WorkspaceLayoutSnapshot,
  WorkspaceLayoutStore,
} from "../state/layout-store";
import type { PaneId, Rect } from "../types";
import {
  dispatchShortcutAction,
  escapePresentationState,
  type OnirigiriShortcutKeyboardEvent,
} from "./workspace-shortcut-runtime";
import type {
  OnirigiriShortcutAction,
  OnirigiriShortcutScope,
} from "./workspace-shortcuts";

export function workspaceShortcutKeyDownHandler(
  shortcutScope: OnirigiriShortcutScope,
  handler: (event: OnirigiriShortcutKeyboardEvent) => void,
): ((event: OnirigiriShortcutKeyboardEvent) => void) | undefined {
  return shortcutScope === "workspace" ? handler : undefined;
}

export function handleWorkspaceEscapeShortcut(
  event: OnirigiriShortcutKeyboardEvent,
  store: WorkspaceLayoutStore,
  setStatusAnnouncement: (announcement: string) => void,
): void {
  const selectionWasGroup =
    store.getSnapshot().paneRearrangementSelection === "group";
  if (!escapePresentationState(store)) {
    return;
  }
  event.preventDefault();
  if (selectionWasGroup) {
    setStatusAnnouncement("Returned to single-pane selection.");
  }
}

interface WorkspaceShortcutDispatchInput {
  event: OnirigiriShortcutKeyboardEvent;
  pendingChromeFocusPaneId: { current: PaneId | null };
  setLayoutSnapshot: (snapshot: WorkspaceLayoutSnapshot) => void;
  setStatusAnnouncement: (announcement: string) => void;
  shortcutAction: OnirigiriShortcutAction;
  store: WorkspaceLayoutStore;
  viewport: Rect;
  workspace: HTMLElement | null;
}

export function dispatchWorkspaceShortcut({
  event,
  pendingChromeFocusPaneId,
  setLayoutSnapshot,
  setStatusAnnouncement,
  shortcutAction,
  store,
  viewport,
  workspace,
}: WorkspaceShortcutDispatchInput): string | null {
  event.preventDefault();
  const result = dispatchShortcutAction(
    shortcutAction,
    store,
    viewport,
    workspace,
  );
  if (result.changed) {
    pendingChromeFocusPaneId.current = result.pendingFocusPaneId;
    if (reservedBlankShortcutChangesStructure(shortcutAction)) {
      setLayoutSnapshot(store.getSnapshot());
    }
  }
  if (result.announcement) {
    setStatusAnnouncement(result.announcement);
  }
  return result.announcement;
}

function reservedBlankShortcutChangesStructure(
  action: OnirigiriShortcutAction,
): boolean {
  return [
    "createBlankSplitAbove",
    "createBlankSplitBelow",
    "removeBlankSplitAbove",
    "removeBlankSplitBelow",
  ].includes(action);
}
