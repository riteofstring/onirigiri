// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

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
