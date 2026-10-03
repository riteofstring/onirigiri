import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OneDimensionalPlayground } from "../one-dimensional/src/one-dimensional-playground";
import { TwoDimensionalPlayground } from "../two-dimensional/src/two-dimensional-playground";
import { readPlaygroundTheme } from "../shared/playground-theme";
import { createPlaygroundPanes } from "../shared/playground-pane-catalog";
import {
  requiredElement,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./workspace-test-support";

const browserStorage = Reflect.get(globalThis, "jsdom").window
  .localStorage as Storage;

beforeEach(() => {
  stubOnirigiriWorkspaceBrowserGlobals();
  vi.stubGlobal("localStorage", browserStorage);
  browserStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  browserStorage.clear();
});

test.each([
  ["1d", OneDimensionalPlayground],
  ["2d", TwoDimensionalPlayground],
] as const)(
  "%s mounts the selected 3D lab document and retains it when focus changes",
  async (model, Playground) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      const panes = createPlaygroundPanes(model, 5, [
        "lab:three-reactor",
        "lab:three-tidal",
        "lab:hover",
      ]);
      await act(async () => root.render(<Playground initialPanes={panes} />));
      const frame = requiredElement<HTMLIFrameElement>(
        container,
        '[data-onirigiri-pane-id="pane-1"] iframe',
      );
      const url = new URL(frame.src);
      expect(url.pathname).toBe("/surface-lab/fixture.html");
      expect(url.searchParams.get("fixture")).toBe("three-reactor");
      expect(url.searchParams.get("embedding")).toBe("surface");
      expect(frame.title).toBe("Chromatic reactor");
      const second = requiredElement<HTMLIFrameElement>(
        container,
        '[data-onirigiri-pane-id="pane-2"] iframe',
      );
      expect(new URL(second.src).searchParams.get("fixture")).toBe(
        "three-tidal",
      );
      expect(second.title).toBe("Tidal lattice");
      const game = requiredElement<HTMLIFrameElement>(
        container,
        '[data-onirigiri-pane-id="pane-3"] iframe',
      );
      expect(new URL(game.src).searchParams.get("fixture")).toBe("hover");
      expect(game.title).toBe("Hover!");
      const workspace = requiredElement<HTMLElement>(
        container,
        '[data-onirigiri-slot="workspace"]',
      );
      await act(async () =>
        workspace.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowRight",
            altKey: true,
            bubbles: true,
          }),
        ),
      );
      expect(
        requiredElement<HTMLElement>(
          container,
          '[data-onirigiri-pane-id="pane-2"]',
        ).dataset.focused,
      ).toBe("true");
      expect(
        container.querySelector('[data-onirigiri-pane-id="pane-1"] iframe'),
      ).toBe(frame);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

test("passes host type sizes and explicit appearance overrides to lab content", () => {
  const host = document.createElement("div");
  host.style.fontFamily = "sans-serif";
  host.style.setProperty("--playground-font-mono", "monospace");
  host.style.setProperty("--playground-font-size", "15px");
  host.style.setProperty("--playground-font-size-heading", "22px");
  host.style.setProperty("--playground-font-size-small", "13px");
  host.style.setProperty("--playground-font-size-label", "12px");
  host.style.setProperty("--playground-font-size-tiny", "11px");
  host.style.setProperty("--playground-font-weight-heading", "600");
  host.style.setProperty("--playground-line-height", "1.5");
  document.body.append(host);
  try {
    const theme = readPlaygroundTheme(host, "light", {
      styles: { accent: "#aa0000", "font-size-heading": "26px" },
    });
    expect(theme.colorMode).toBe("light");
    expect(theme.styles).toMatchObject({
      "font-family": "sans-serif",
      "font-mono": "monospace",
      "font-size": "15px",
      "font-size-heading": "26px",
      "font-size-small": "13px",
      "font-size-label": "12px",
      "font-size-tiny": "11px",
      "font-weight-heading": "600",
      "line-height": "1.5",
      accent: "#aa0000",
    });
  } finally {
    host.remove();
  }
});
