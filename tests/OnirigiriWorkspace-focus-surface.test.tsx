import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import type { OnirigiriWorkspaceHandle } from "../src/workspace/onirigiri-workspace-types";

import {
  requiredElement,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

describe("OnirigiriWorkspace focus surface", () => {
  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders one decorative cursor with the workspace as Tab and status owner", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "test-pane", surfaceKind: "test", title: "Test pane" },
          ]}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });

    const workspace = requiredElement<HTMLElement>(
      container,
      ".onirigiri-workspace",
    );
    const cursor = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="grid-cursor"]',
    );
    expect(
      container.querySelectorAll('[data-onirigiri-slot="grid-cursor"]'),
    ).toHaveLength(1);
    expect(workspace.tabIndex).toBe(0);
    expect(cursor.getAttribute("aria-hidden")).toBe("true");
    expect(cursor.getAttribute("tabindex")).toBeNull();
    expect(cursor.getAttribute("role")).toBeNull();
    expect(
      container.querySelector('[data-onirigiri-slot="status"][role="status"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("focuses the clicked pane and selects it from overview", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "first-pane", surfaceKind: "test", title: "First pane" },
            {
              paneId: "second-pane",
              surfaceKind: "test",
              title: "Second pane",
            },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });

    await act(async () => workspaceRef.current?.toggleOverview());
    const secondPane = container.querySelector<HTMLElement>(
      '[data-onirigiri-pane-id="second-pane"]',
    );
    expect(secondPane).not.toBeNull();

    await act(async () => secondPane?.click());
    expect(workspaceRef.current?.getSnapshot().focusedPaneId).toBe(
      "second-pane",
    );
    expect(workspaceRef.current?.getSnapshot().presentationMode).toBe("normal");

    await act(async () => root.unmount());
    container.remove();
  });
});
