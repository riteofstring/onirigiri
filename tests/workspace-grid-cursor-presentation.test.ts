import { describe, expect, it, vi } from "vitest";

import { WorkspaceGridCursorPresentation } from "../src/workspace/workspace-grid-cursor-presentation";
import type { WorkspaceGridCursorRenderItem } from "../src/types";

describe("WorkspaceGridCursorPresentation", () => {
  it("keeps one decorative host and retargets from its displayed box", () => {
    const presentation = new WorkspaceGridCursorPresentation();
    const host = document.createElement("div");
    const animation = { cancel: vi.fn(), pause: vi.fn(), currentTime: null };
    host.animate = vi.fn(() => animation as unknown as Animation);
    presentation.bindCursorHost(host);

    presentation.apply(cursorItem(), false);
    expect(host.dataset.cellKind).toBe("occupied");
    expect(host.dataset.presentationMode).toBe("normal");
    expect(host.dataset.visible).toBe("true");
    expect(host.style.transform).toBe(
      "translate3d(8.00px, 12.00px, 0) scale(1.0000)",
    );

    const destination = cursorItem({
      cursor: { column: 1, row: 0, split: 0 },
      height: 180,
      kind: "empty",
      paneId: null,
      width: 300,
      x: 336,
      y: 12,
    });
    expect(presentation.retarget(destination)).toBe(true);
    presentation.apply(destination, true);
    expect(host.style.transform).toBe(
      "translate3d(8.00px, 12.00px, 0) scale(1.0000)",
    );

    presentation.advanceMotion(48);
    presentation.apply(destination, true);
    const inFlightTransform = host.style.transform;
    expect(inFlightTransform).not.toBe(
      "translate3d(8.00px, 12.00px, 0) scale(1.0000)",
    );
    expect(inFlightTransform).not.toBe(
      "translate3d(336.00px, 12.00px, 0) scale(1.0000)",
    );

    expect(presentation.retarget(cursorItem())).toBe(true);
    presentation.apply(cursorItem(), true);
    expect(host.style.transform).toBe(inFlightTransform);
    expect(host.animate).toHaveBeenCalledTimes(1);
    expect(animation.pause).toHaveBeenCalledTimes(1);

    presentation.advanceMotion(1000);
    presentation.apply(cursorItem(), false);
    expect(host.style.transform).toBe(
      "translate3d(8.00px, 12.00px, 0) scale(1.0000)",
    );
    expect(animation.cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["settle", "snap", "same destination", "unbind", "rebind"])(
    "releases the outline's motion animation on %s",
    (ending) => {
      const presentation = new WorkspaceGridCursorPresentation();
      const host = document.createElement("div");
      const animation = { cancel: vi.fn(), pause: vi.fn(), currentTime: null };
      host.animate = vi.fn(() => animation as unknown as Animation);
      const unbind = presentation.bindCursorHost(host);
      const item = cursorItem();
      presentation.apply(item, false);
      expect(host.animate).not.toHaveBeenCalled();
      presentation.apply(item, true);
      presentation.apply(item, true);
      expect(host.animate).toHaveBeenCalledTimes(1);
      const displayed = host.style.transform;

      if (ending === "settle") presentation.apply(item, false);
      if (ending === "snap") presentation.snapMotion();
      if (ending === "same destination") {
        expect(presentation.retarget(item)).toBe(false);
      }
      if (ending === "unbind") unbind();
      if (ending === "rebind") {
        presentation.bindCursorHost(document.createElement("div"));
      }

      expect(animation.cancel).toHaveBeenCalledTimes(1);
      expect(host.style.transform).toBe(displayed);
    },
  );

  it("keeps its outline crisp at overview scale and snaps under reduced motion", () => {
    const presentation = new WorkspaceGridCursorPresentation();
    const host = document.createElement("div");
    presentation.bindCursorHost(host);
    const normal = cursorItem();
    const overview = cursorItem({
      presentationMode: "overview",
      scale: 0.25,
      x: 120,
      y: 80,
    });

    presentation.apply(normal, false);
    expect(presentation.retarget(overview)).toBe(true);
    presentation.snapMotion();
    presentation.apply(overview, false);

    expect(presentation.hasActiveMotion()).toBe(false);
    expect(host.style.transform).toBe(
      "translate3d(120.00px, 80.00px, 0) scale(0.2500)",
    );
    expect(host.style.borderWidth).toBe("4px");
  });
});

function cursorItem(
  overrides: Partial<WorkspaceGridCursorRenderItem> = {},
): WorkspaceGridCursorRenderItem {
  return {
    cursor: { column: 0, row: 0, split: 0 },
    height: 240,
    kind: "occupied",
    paneId: "pane",
    presentationMode: "normal",
    scale: 1,
    structural: true,
    width: 300,
    x: 8,
    y: 12,
    ...overrides,
  };
}
