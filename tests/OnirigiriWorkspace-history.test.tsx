import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import type { OnirigiriWorkspaceHandle } from "../src/workspace/onirigiri-workspace-types";
import {
  requiredElement,
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
  workspaceRowSizingSnapshot,
} from "./onirigiri-workspace-test-support";

describe("OnirigiriWorkspace layout restore", () => {
  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("restores the declared default width and equal row distribution", async () => {
    const { container, root, workspace } = await renderedWorkspace();

    await act(async () => workspace.resizePanes("minimum"));
    await act(async () => workspace.resizePanes("default"));

    expect(
      workspace.getScene().columns.map((column) => column.widthSpec),
    ).toEqual([
      { unit: "px", value: 520 },
      { unit: "px", value: 520 },
    ]);
    expect(workspaceRowSizingSnapshot(workspace.getScene())).toEqual([
      {
        columnId: "split-column",
        rowSizing: [{ weight: 1 }, { weight: 1 }],
      },
      { columnId: "right-column", rowSizing: [{ weight: 1 }] },
    ]);

    await act(async () => root.unmount());
    container.remove();
  });

  it("validates before restoring and reports a restore without remounting panes", async () => {
    const { container, onLayoutChange, root, workspace } =
      await renderedWorkspace();
    const firstPaneHost = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="split-top"]',
    );
    const originalLayout = workspace.getLayout();

    onLayoutChange.mockClear();
    await act(async () => workspace.resizePanes("minimum"));
    await act(async () => workspace.restoreLayout(originalLayout));

    expect(workspace.getLayout()).toEqual(originalLayout);
    expect(
      requiredElement(container, '[data-onirigiri-pane-id="split-top"]'),
    ).toBe(firstPaneHost);
    expect(onLayoutChange.mock.lastCall?.[1]).toMatchObject({
      kind: "restore",
      mutationId: expect.any(Number),
      layoutRevision: expect.any(Number),
    });

    const layoutBeforeInvalidRestore = workspace.getLayout();
    const invalidLayout = { ...originalLayout, schemaVersion: 3 };
    expect(() => workspace.restoreLayout(invalidLayout)).toThrow(
      "unsupported Onirigiri layout schema 3",
    );
    expect(workspace.getLayout()).toEqual(layoutBeforeInvalidRestore);

    await act(async () => root.unmount());
    container.remove();
  });
});

async function renderedWorkspace() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
  const onLayoutChange = vi.fn();

  await act(async () => {
    root.render(
      <OnirigiriWorkspace
        initialPanes={[
          {
            columnId: "split-column",
            columnWidth: { unit: "px", value: 420 },
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
          {
            columnId: "right-column",
            columnWidth: { unit: "px", value: 360 },
            paneId: "right",
            surfaceKind: "test",
            title: "Right",
          },
        ]}
        onLayoutChange={onLayoutChange}
        ref={workspaceRef}
        renderPane={() => <div>Test content</div>}
      />,
    );
  });
  return {
    container,
    onLayoutChange,
    root,
    workspace: requiredWorkspaceHandle(workspaceRef.current),
  };
}
