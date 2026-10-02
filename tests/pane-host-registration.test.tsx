import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import type { OnirigiriWorkspaceHandle } from "../src/workspace/onirigiri-workspace-types";
import { PanePresentationEngine } from "../src/presentation/pane-presentation-engine";

import {
  requiredElement,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

describe("pane host registration", () => {
  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps one presenter binding across React presentation boundaries", async () => {
    const registerPaneHost = vi.spyOn(
      PanePresentationEngine.prototype,
      "registerPaneHost",
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "pane", surfaceKind: "test", title: "Pane" },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Consumer content</div>}
        />,
      );
    });
    expect(registerPaneHost).toHaveBeenCalledTimes(1);

    await act(async () => workspaceRef.current?.toggleOverview());
    expect(
      requiredElement<HTMLElement>(container, '[data-onirigiri-pane-id="pane"]')
        .dataset.presentationMode,
    ).toBe("overview");
    expect(registerPaneHost).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    container.remove();
  });

  it("omits pane actions when controls are disabled across overview", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "pane", surfaceKind: "test", title: "Pane" },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Consumer content</div>}
          showControls={false}
        />,
      );
    });
    expect(
      container.querySelectorAll('[data-onirigiri-slot="pane-action"]'),
    ).toHaveLength(0);

    await act(async () => workspaceRef.current?.toggleOverview());
    expect(
      container.querySelectorAll('[data-onirigiri-slot="pane-action"]'),
    ).toHaveLength(0);

    await act(async () => root.unmount());
    container.remove();
  });
});
