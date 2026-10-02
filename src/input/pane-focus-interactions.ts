import type { WorkspaceLayoutStore } from "../state/layout-store";
import type { PaneId, Rect, WorkspacePresentationMode } from "../types";

interface PaneFocusTarget {
  paneId: PaneId;
  reveal: boolean;
}

function paneFocusTargetFromEvent(
  eventTarget: EventTarget | null,
  workspace: HTMLElement | null,
): PaneFocusTarget | null {
  if (!(eventTarget instanceof Element) || !workspace) {
    return null;
  }
  const pane = eventTarget.closest<HTMLElement>(
    '[data-onirigiri-pane-id][data-visible="true"]',
  );
  if (
    !pane ||
    pane.closest<HTMLElement>(".onirigiri-workspace") !== workspace
  ) {
    return null;
  }
  if (eventTarget.closest('[data-onirigiri-pane-control="true"]')) {
    return null;
  }
  const paneId = pane.dataset.onirigiriPaneId;
  if (!paneId) {
    return null;
  }
  const titlebar = eventTarget.closest<HTMLElement>(
    '[data-onirigiri-pane-titlebar="true"]',
  );
  return {
    paneId,
    reveal: titlebar?.closest<HTMLElement>("[data-onirigiri-pane-id]") === pane,
  };
}

export function focusPaneFromPointer({
  button,
  eventTarget,
  focusedPaneId,
  moving,
  presentationMode,
  store,
  viewport,
  workspace,
}: {
  button: number;
  eventTarget: EventTarget | null;
  focusedPaneId: PaneId | null;
  moving: boolean;
  presentationMode: WorkspacePresentationMode;
  store: WorkspaceLayoutStore;
  viewport: Rect;
  workspace: HTMLElement | null;
}): void {
  if (button !== 0 || moving || presentationMode === "overview") {
    return;
  }
  const target = paneFocusTargetFromEvent(eventTarget, workspace);
  if (!target) {
    return;
  }
  if (!target.reveal) {
    if (target.paneId !== focusedPaneId) {
      store.focusPaneWithoutReveal(target.paneId);
    }
    return;
  }
  if (store.focusPane(target.paneId)) {
    store.ensureFocusedPaneVisible(viewport);
  }
}

export function focusOverviewPaneFromClick({
  eventTarget,
  presentationMode,
  store,
  viewport,
  workspace,
}: {
  eventTarget: EventTarget | null;
  presentationMode: WorkspacePresentationMode;
  store: WorkspaceLayoutStore;
  viewport: Rect;
  workspace: HTMLElement | null;
}): void {
  if (presentationMode !== "overview") {
    return;
  }
  const target = paneFocusTargetFromEvent(eventTarget, workspace);
  if (target) {
    store.focusOverviewPane(target.paneId, viewport);
  }
}
