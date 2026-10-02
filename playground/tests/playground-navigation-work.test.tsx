import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OneDimensionalPlayground } from "../one-dimensional/src/one-dimensional-playground";
import { TwoDimensionalPlayground } from "../two-dimensional/src/two-dimensional-playground";
import type { WorkspacePane } from "@riteofstring/onirigiri";
import {
  requiredElement,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./workspace-test-support";

const consumers = vi.hoisted(() => new Map<string, number>());
const browserStorage = Reflect.get(globalThis, "jsdom").window
  .localStorage as Storage;

vi.mock("../shared/playground-content", async (original) => ({
  ...(await original<typeof import("../shared/playground-content")>()),
  PlaygroundPane: ({ pane }: { pane: WorkspacePane }) => {
    consumers.set(pane.paneId, (consumers.get(pane.paneId) ?? 0) + 1);
    return (
      <input data-consumer={pane.paneId} defaultValue="Retained content" />
    );
  },
}));

beforeEach(() => {
  stubOnirigiriWorkspaceBrowserGlobals();
  vi.stubGlobal("localStorage", browserStorage);
  browserStorage.clear();
  consumers.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  browserStorage.clear();
});

test.each([
  ["1D", OneDimensionalPlayground],
  ["2D", TwoDimensionalPlayground],
] as const)(
  "%s navigation does not rerender parked consumers",
  async (_model, Playground) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <Playground
            initialPanes={Array.from({ length: 20 }, (_, index) => ({
              paneId: `pane-${index + 1}`,
              columnId: `column-${index + 1}`,
              slotIndex: index,
              surfaceKind: "notes",
              title: `Pane ${index + 1}`,
            }))}
          />,
        ),
      );
      const parked = requiredElement<HTMLInputElement>(
        container,
        '[data-consumer="pane-20"]',
      );
      parked.value = "Edited offscreen";
      const before = consumers.get("pane-20");
      expect(before).toBeGreaterThan(0);
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
      expect(consumers.get("pane-20")).toBe(before);
      expect(container.querySelector('[data-consumer="pane-20"]')).toBe(parked);
      expect(parked.value).toBe("Edited offscreen");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
