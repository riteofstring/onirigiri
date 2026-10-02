export function assertVisiblePaneSurface(workspace: HTMLElement): void {
  const visiblePanes = workspace.querySelectorAll<HTMLElement>(
    '[data-onirigiri-pane-id][data-visible="true"]',
  );
  if (visiblePanes.length === 0) {
    throw new Error("Overview has no visible pane surfaces.");
  }
  for (const pane of visiblePanes) {
    const paneId = pane.getAttribute("data-onirigiri-pane-id");
    const surfaces = pane.querySelectorAll<HTMLElement>(
      '.onirigiri-pane__live-content, [data-onirigiri-slot="pane-placeholder"], .onirigiri-pane__picture',
    );
    const hasSurface = [...surfaces].some(
      (surface) => surfacePopulated(surface) && surfaceVisible(surface),
    );
    if (
      !paneId ||
      !["live", "frozen"].includes(pane.dataset.runtimeState ?? "") ||
      !hasSurface
    ) {
      throw new Error(`Visible pane ${paneId ?? "unknown"} lost its surface.`);
    }
  }
}

function surfacePopulated(surface: HTMLElement): boolean {
  if (surface instanceof HTMLImageElement)
    return surface.complete && surface.naturalWidth > 0;
  return surface.childElementCount > 0 || Boolean(surface.textContent?.trim());
}

function surfaceVisible(surface: HTMLElement): boolean {
  const visibility = getComputedStyle(surface).visibility;
  if (visibility === "hidden" || visibility === "collapse") return false;
  for (
    let element: HTMLElement | null = surface;
    element;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.opacity === "0") return false;
  }
  return true;
}
