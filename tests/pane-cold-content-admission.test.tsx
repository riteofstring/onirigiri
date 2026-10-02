import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import {
  requiredElement,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

describe("cold pane content admission", () => {
  beforeEach(() => stubOnirigiriWorkspaceBrowserGlobals());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([2, 8])(
    "mounts visible content without eagerly filling a %i-viewport retention budget",
    async (budget) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            <OnirigiriWorkspace
              compactBreakpoint={2_000}
              initialPanes={Array.from({ length: 10 }, (_, index) => ({
                columnId: `column-${index + 1}`,
                columnWidth: { unit: "px" as const, value: 1_200 },
                paneId: `pane-${index + 1}`,
                slotIndex: index,
                surfaceKind: "test",
                title: `Pane ${index + 1}`,
              }))}
              renderPane={(pane) => (
                <input aria-label={pane.title} data-consumer={pane.paneId} />
              )}
              retainedAreaBudgetViewports={budget}
              showControls={false}
            />,
          );
        });
        expect(
          container.querySelectorAll('[data-onirigiri-slot="pane"]'),
        ).toHaveLength(10);
        expect(
          [...container.querySelectorAll("[data-consumer]")].map((node) =>
            node.getAttribute("data-consumer"),
          ),
        ).toEqual(["pane-1"]);
        const neighbor = requiredElement<HTMLElement>(
          container,
          '[data-onirigiri-pane-id="pane-2"]',
        );
        expect(neighbor.dataset.visible).toBe("false");
        expect(neighbor.textContent).toContain("Pane 2");
        expect(neighbor.querySelector("input")).toBeNull();
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );
});
