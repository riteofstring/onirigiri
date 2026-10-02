import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import type { OnirigiriWorkspaceHandle } from "../src/workspace/onirigiri-workspace-types";
import {
  requiredElement,
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

describe("OnirigiriWorkspace split rearrangement", () => {
  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("announces a selected split group and renders a reserved blank without a pane host", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            {
              columnId: "stack",
              paneId: "top",
              surfaceKind: "test",
              title: "Top",
            },
            {
              columnId: "stack",
              paneId: "bottom",
              surfaceKind: "test",
              title: "Bottom",
            },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="top"]',
    ).focus();

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        key: "g",
        shiftKey: true,
      });
    });
    expect(workspace.getSnapshot()).toMatchObject({
      paneRearrangementSelection: "group",
      selectedGroupColumnId: "stack",
    });
    const selectedPanes = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-group-selected="true"]',
      ),
    ];
    expect(selectedPanes).toHaveLength(2);
    expect(selectedPanes[0]?.getAttribute("aria-label")).toContain(
      "selected rearrangement group",
    );
    expect(
      requiredElement<HTMLElement>(container, '[data-onirigiri-slot="status"]')
        .textContent,
    ).toBe("Selected the split group containing Top.");

    await act(async () => {
      dispatchKeyDown(document.activeElement, { key: "Escape" });
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        key: "ArrowDown",
        shiftKey: true,
      });
    });
    const reservedBlank = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="reserved-split"]',
    );
    expect(reservedBlank.closest("[data-onirigiri-pane-id]")).toBeNull();
    expect(reservedBlank.querySelector("button")).toBeNull();
    expect(workspace.getScene().columns[0]?.cells).toContainEqual({
      paneId: null,
      reserved: true,
      weight: 1,
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps Fixed split-cell swaps and immediate reversals mounted through the presenter handoff", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            {
              columnId: "source-column",
              columnWidth: { unit: "px", value: 360 },
              paneId: "source",
              surfaceKind: "test",
              title: "Source",
            },
            {
              columnId: "split-column",
              columnWidth: { unit: "px", value: 360 },
              heightPx: 180,
              paneId: "split-top",
              surfaceKind: "test",
              title: "Split top",
            },
            {
              columnId: "split-column",
              paneId: "split-bottom",
              surfaceKind: "test",
              title: "Split bottom",
            },
          ]}
          ref={workspaceRef}
          renderPane={(pane) => <div data-live-pane={pane.paneId} />}
          showControls={false}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const paneIds = ["source", "split-top", "split-bottom"] as const;
    const originalHosts = new Map(
      paneIds.map((paneId) => [
        paneId,
        requiredElement<HTMLElement>(
          container,
          `[data-onirigiri-pane-id="${paneId}"]`,
        ),
      ]),
    );

    await act(async () => {
      expect(workspace.movePane("right")).toBe(true);
    });

    expect(paneIdsForColumn(workspace, "source-column")).toEqual(["split-top"]);
    expect(paneIdsForColumn(workspace, "split-column")).toEqual([
      "source",
      "split-bottom",
    ]);
    expectFixedSplitHandoff(container, originalHosts);

    await act(async () => {
      expect(workspace.movePane("left")).toBe(true);
    });

    expect(paneIdsForColumn(workspace, "source-column")).toEqual(["source"]);
    expect(paneIdsForColumn(workspace, "split-column")).toEqual([
      "split-top",
      "split-bottom",
    ]);
    expectFixedSplitHandoff(container, originalHosts);

    await act(async () => root.unmount());
    container.remove();
  });
});

function paneIdsForColumn(
  workspace: OnirigiriWorkspaceHandle,
  columnId: string,
): Array<string | null> | undefined {
  return workspace
    .getScene()
    .columns.find((column) => column.columnId === columnId)
    ?.cells.map((cell) => cell.paneId);
}

function expectFixedSplitHandoff(
  container: HTMLElement,
  originalHosts: ReadonlyMap<string, HTMLElement>,
): void {
  const hosts = [
    ...container.querySelectorAll<HTMLElement>("[data-onirigiri-pane-id]"),
  ];
  expect(hosts).toHaveLength(3);
  for (const [paneId, originalHost] of originalHosts) {
    const host = requiredElement<HTMLElement>(
      container,
      `[data-onirigiri-pane-id="${paneId}"]`,
    );
    expect(host).toBe(originalHost);
    expect(host.hidden).toBe(false);
    expect(host.dataset.moving, paneId).toBe("true");
    expect(host.dataset.runtimeState, paneId).toBe("frozen");
    expect(host.dataset.visible, paneId).toBe("true");
    expect(host.querySelector(`[data-live-pane="${paneId}"]`)).not.toBeNull();
  }
}

function dispatchKeyDown(
  target: EventTarget | null,
  init: KeyboardEventInit,
): KeyboardEvent {
  if (!target) {
    throw new Error("missing keyboard target");
  }
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}
