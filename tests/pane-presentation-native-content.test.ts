// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { PanePresentationEngine } from "../src/presentation/pane-presentation-engine";

import {
  paneHostWithNativeContent,
  renderItem,
  setContentViewportSize,
  snapshot,
  viewport,
} from "./pane-presentation-engine-test-support";

describe("PanePresentationEngine native content", () => {
  it("keeps native live content on the current pane body through an unequal-aspect rearrangement", () => {
    const presentation = new PanePresentationEngine();
    const { content, host, liveSurface } = paneHostWithNativeContent();
    setContentViewportSize(content, host, 40);
    const source = renderItem({
      height: 220,
      paneId: "source",
      width: 420,
    });
    const destination = {
      ...source,
      height: 460,
      width: 240,
      x: 360,
    };
    presentation.registerPaneHost("source", host, source);

    expect(presentation.retargetPaneRearrangement([destination])).toBe(true);
    for (const elapsed of [0, 40, 120]) {
      if (elapsed > 0) {
        presentation.advancePaneRearrangement(elapsed);
      }
      presentation.apply(
        [{ ...destination, moving: true, runtimeState: "frozen" }],
        snapshot(),
        false,
        viewport,
      );
      expect(liveSurface.style.width).toBe("");
      expect(liveSurface.style.height).toBe("");
      expect(liveSurface.style.transform).toBe("");
      expect(Number.parseFloat(host.style.width)).toBeGreaterThan(0);
      expect(Number.parseFloat(host.style.height)).toBeGreaterThan(0);
    }

    expect(host.style.width).toBe("240px");
    expect(host.style.height).toBe("460px");
    presentation.apply([destination], snapshot(), false, viewport);
    expect(liveSurface.style.width).toBe("");
    expect(liveSurface.style.height).toBe("");
    expect(liveSurface.style.transform).toBe("");
  });
});

describe("PanePresentationEngine content measurement", () => {
  it("measures pane chrome only when its layout-affecting state changes", () => {
    const presentation = new PanePresentationEngine();
    const { host } = paneHostWithNativeContent();
    host.style.borderBottomLeftRadius = "14px";
    const item = renderItem({ paneId: "measured" });
    presentation.registerPaneHost("measured", host, item);
    const hostStyleReads = () =>
      getComputedStyle.mock.calls.filter(([element]) => element === host)
        .length;
    const getComputedStyle = vi.spyOn(window, "getComputedStyle");
    presentation.apply([item], snapshot(), false, viewport);
    expect(hostStyleReads()).toBe(1);
    expect(presentation.presentedPaneGeometries([item])[0]!.cornerRadius).toBe(
      14,
    );

    for (const x of [40, 80, 120]) {
      const moved = { ...item, x, moving: true };
      presentation.updatePaneHostBoundary("measured", moved);
      presentation.apply([moved], snapshot(), false, viewport);
    }
    expect(hostStyleReads()).toBe(1);

    const maximized = { ...item, maximized: true };
    presentation.updatePaneHostBoundary("measured", maximized);
    presentation.apply([maximized], snapshot(), false, viewport);
    expect(hostStyleReads()).toBe(2);
    getComputedStyle.mockRestore();
  });
});
