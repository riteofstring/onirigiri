import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  matchOnirigiriShortcutAction,
  normalizeOnirigiriShortcutBindings,
} from "../src/input/workspace-shortcuts";
import type { OnirigiriWorkspaceControlButtonProps } from "../src/styles/onirigiri-styling";
import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import type { OnirigiriWorkspaceHandle } from "../src/workspace/onirigiri-workspace-types";

import {
  activePaneId,
  paneLocation,
  requiredElement,
  requiredPaneId,
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

describe("OnirigiriWorkspace keyboard shortcuts", () => {
  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["MacIntel", "ø", true, "⌥ Option + O"],
    ["Win32", "o", true, "Alt + O"],
    ["Win32", "ø", false, "Alt + O"],
  ] as const)(
    "handles overview key %s / %s with matching labels",
    async (platform, key, active, label) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
      const overviewShortcutLabels: string[] = [];
      function ShortcutLabelButton({
        control,
        ...props
      }: OnirigiriWorkspaceControlButtonProps) {
        if (control.id === "overview") {
          overviewShortcutLabels.push(control.shortcuts[0]?.label ?? "");
        }
        return <button {...props} />;
      }
      try {
        await act(async () =>
          root.render(
            <OnirigiriWorkspace
              chromeComponents={{ WorkspaceControlButton: ShortcutLabelButton }}
              initialPanes={[
                { paneId: "first", surfaceKind: "test", title: "First" },
              ]}
              ref={workspaceRef}
              renderPane={() => <div>Test content</div>}
            />,
          ),
        );
        const workspace = requiredWorkspaceHandle(workspaceRef.current);
        const region = requiredElement<HTMLElement>(
          container,
          '[data-onirigiri-slot="workspace"]',
        );
        const overview = requiredElement<HTMLElement>(
          container,
          'button[aria-label="Open workspace overview"]',
        );
        expect(overviewShortcutLabels.at(-1)).toBe(label);
        expect(overview.getAttribute("aria-keyshortcuts")).toBe("Alt+O");
        for (const mode of [active ? "overview" : "normal", "normal"]) {
          await act(async () => {
            const event = dispatchKeyDown(region, {
              altKey: true,
              code: "KeyO",
              key,
            });
            expect(event.defaultPrevented).toBe(active);
          });
          expect(workspace.getSnapshot().presentationMode).toBe(mode);
        }
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );

  it("prefers an explicit Option character binding to the physical letter", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const event = {
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      code: "KeyO",
      key: "ø",
    };
    const shortcuts = normalizeOnirigiriShortcutBindings({
      focusRight: { ...event, key: "ø" },
    });
    expect(matchOnirigiriShortcutAction(event, shortcuts)).toBe("focusRight");
  });

  it("keeps first-column navigation distinct from return home", () => {
    const shortcuts = normalizeOnirigiriShortcutBindings(undefined);
    expect(
      matchOnirigiriShortcutAction(
        {
          altKey: true,
          code: "Home",
          ctrlKey: false,
          key: "Home",
          metaKey: false,
          shiftKey: false,
        },
        shortcuts,
      ),
    ).toBe("focusFirstColumn");
    expect(
      matchOnirigiriShortcutAction(
        {
          altKey: true,
          code: "Home",
          ctrlKey: false,
          key: "Home",
          metaKey: false,
          shiftKey: true,
        },
        shortcuts,
      ),
    ).toBe("returnHome");
  });

  it("uses Onirigiri-style aliases to focus and rearrange only the focused pane", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            {
              columnId: "first-column",
              paneId: "first-top",
              surfaceKind: "test",
              title: "First top",
            },
            {
              columnId: "first-column",
              paneId: "first-bottom",
              surfaceKind: "test",
              title: "First bottom",
            },
            {
              columnId: "middle-column",
              paneId: "middle",
              surfaceKind: "test",
              title: "Middle",
            },
            {
              columnId: "last-column",
              paneId: "last",
              surfaceKind: "test",
              title: "Last",
            },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const firstPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="first-top"]',
    );
    const cursorSurface = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="grid-cursor"]',
    );
    firstPane.focus();

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        key: "ArrowRight",
      });
    });
    expect(workspace.getSnapshot().focusedPaneId).toBe("middle");
    expect(activePaneId()).toBe("middle");
    expect(
      requiredElement<HTMLElement>(
        container,
        '[data-onirigiri-slot="grid-cursor"]',
      ),
    ).toBe(cursorSurface);

    await act(async () => {
      dispatchKeyDown(document.activeElement, { altKey: true, key: "h" });
    });
    expect(workspace.getSnapshot().focusedPaneId).toBe("first-top");

    await act(async () => {
      dispatchKeyDown(document.activeElement, { altKey: true, key: "End" });
    });
    expect(workspace.getSnapshot().focusedPaneId).toBe("last");
    await act(async () => {
      dispatchKeyDown(document.activeElement, { altKey: true, key: "Home" });
    });
    expect(workspace.getSnapshot().focusedPaneId).toBe("first-top");

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "l",
      });
    });
    expect(
      workspace
        .getScene()
        .columns.filter((column) => column.planeIndex === 0)
        .map((column) => paneIds(column)),
    ).toEqual([["middle", "first-bottom"], ["first-top"], ["last"]]);
    expect(workspace.getSnapshot().focusedPaneId).toBe("first-top");
    expect(activePaneId()).toBe("first-top");
    expect(
      requiredElement<HTMLElement>(container, '[data-onirigiri-slot="status"]')
        .textContent,
    ).toBe("Moved First top right to grid cell (1, 0), split 1.");

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "h",
      });
    });
    expect(
      workspace
        .getScene()
        .columns.filter((column) => column.planeIndex === 0)
        .map((column) => paneIds(column)),
    ).toEqual([["first-top", "first-bottom"], ["middle"], ["last"]]);

    let removedColumnShortcut: KeyboardEvent | undefined;
    await act(async () => {
      removedColumnShortcut = dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "End",
      });
    });
    expect(removedColumnShortcut?.defaultPrevented).toBe(false);

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "j",
      });
    });
    expect(
      paneIds(
        workspace
          .getScene()
          .columns.find((column) => column.columnId === "first-column"),
      ),
    ).toEqual(["first-bottom", "first-top"]);
    expect(
      requiredElement<HTMLElement>(container, '[data-onirigiri-slot="status"]')
        .textContent,
    ).toBe("Moved First top down to grid cell (0, 0), split 2.");

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "ArrowUp",
      });
    });
    expect(
      paneIds(
        workspace
          .getScene()
          .columns.find((column) => column.columnId === "first-column"),
      ),
    ).toEqual(["first-top", "first-bottom"]);
    expect(workspace.getSnapshot().focusedPaneId).toBe("first-top");

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not retain pane chrome in a structural empty cell after a keyboard round trip", async () => {
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
              paneId: "moving",
              surfaceKind: "test",
              title: "Moving",
            },
            {
              columnId: "far-column",
              paneId: "far",
              slotIndex: 2,
              surfaceKind: "test",
              title: "Far",
            },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const movingPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="moving"]',
    );
    movingPane.focus();

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "ArrowRight",
      });
    });

    expect(
      workspace
        .getScene()
        .columns.find((column) => column.columnId === "source-column"),
    ).toBeUndefined();
    expect(
      container.querySelector('[data-onirigiri-column-id="source-column"]'),
    ).toBeNull();
    expectRenderedPaneChromeMatchesScene(container, workspace.getScene());

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "h",
      });
    });

    expect(
      paneIds(
        workspace.getScene().columns.find((column) => column.slotIndex === 0),
      ),
    ).toEqual(["moving"]);
    expectRenderedPaneChromeMatchesScene(container, workspace.getScene());

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps directional pane aliases lossless in overview without remounting pane content", async () => {
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
              paneId: "source",
              planeIndex: 0,
              slotIndex: 0,
              surfaceKind: "test",
              title: "Source",
            },
            {
              columnId: "right-column",
              paneId: "right",
              planeIndex: 0,
              slotIndex: 1,
              surfaceKind: "test",
              title: "Right",
            },
            {
              columnId: "lower-column",
              paneId: "lower",
              planeIndex: 1,
              slotIndex: 0,
              surfaceKind: "test",
              title: "Lower",
            },
          ]}
          ref={workspaceRef}
          renderPane={(pane) => <input aria-label={`${pane.paneId} content`} />}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const sourceContent = requiredElement<HTMLInputElement>(
      container,
      '[aria-label="source content"]',
    );
    const sourcePane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="source"]',
    );
    sourcePane.focus();

    await act(async () => workspace.toggleOverview());
    expect(workspace.getSnapshot().presentationMode).toBe("overview");

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "ArrowRight",
      });
    });
    expect(paneLocation(workspace, "source")).toEqual({
      planeIndex: 0,
      slotIndex: 1,
    });

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "h",
      });
    });
    expect(paneLocation(workspace, "source")).toEqual({
      planeIndex: 0,
      slotIndex: 0,
    });

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "j",
      });
    });
    expect(paneLocation(workspace, "source")).toEqual({
      planeIndex: 1,
      slotIndex: 0,
    });

    await act(async () => {
      dispatchKeyDown(document.activeElement, {
        altKey: true,
        ctrlKey: true,
        key: "ArrowUp",
      });
    });
    expect(paneLocation(workspace, "source")).toEqual({
      planeIndex: 0,
      slotIndex: 0,
    });
    expect(workspace.getSnapshot().presentationMode).toBe("overview");
    expect(
      requiredElement<HTMLInputElement>(
        container,
        '[aria-label="source content"]',
      ),
    ).toBe(sourceContent);

    await act(async () => root.unmount());
    container.remove();
  });

  it("supports default and configured plane shortcuts while retaining focus", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "source", surfaceKind: "test", title: "Source" },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const sourcePane = container.querySelector<HTMLElement>(
      '[data-onirigiri-pane-id="source"]',
    );
    sourcePane?.focus();

    let defaultUpEvent: KeyboardEvent | undefined;
    await act(async () => {
      defaultUpEvent = dispatchKeyDown(sourcePane, {
        ctrlKey: true,
        key: "{",
        shiftKey: true,
      });
    });
    expect(defaultUpEvent?.defaultPrevented).toBe(true);
    const defaultUpId = requiredPaneId(workspace.getSnapshot().focusedPaneId);
    expect(activePaneId()).toBe(defaultUpId);

    let defaultDownEvent: KeyboardEvent | undefined;
    await act(async () => {
      defaultDownEvent = dispatchKeyDown(document.activeElement, {
        ctrlKey: true,
        key: "}",
        shiftKey: true,
      });
    });
    expect(defaultDownEvent?.defaultPrevented).toBe(true);
    const defaultDownId = requiredPaneId(workspace.getSnapshot().focusedPaneId);
    expect(activePaneId()).toBe(defaultDownId);

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "source", surfaceKind: "test", title: "Source" },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
          shortcuts={{
            splitPlaneDown: {
              altKey: true,
              ctrlKey: false,
              key: "d",
              metaKey: false,
              shiftKey: true,
            },
          }}
        />,
      );
    });

    let replacedDefaultEvent: KeyboardEvent | undefined;
    await act(async () => {
      replacedDefaultEvent = dispatchKeyDown(document.activeElement, {
        ctrlKey: true,
        key: "}",
        shiftKey: true,
      });
    });
    expect(replacedDefaultEvent?.defaultPrevented).toBe(false);
    expect(workspace.getScene().columns).toHaveLength(3);

    let configuredDownEvent: KeyboardEvent | undefined;
    await act(async () => {
      configuredDownEvent = dispatchKeyDown(document.activeElement, {
        altKey: true,
        key: "D",
        shiftKey: true,
      });
    });
    expect(configuredDownEvent?.defaultPrevented).toBe(true);
    const configuredDownId = requiredPaneId(
      workspace.getSnapshot().focusedPaneId,
    );
    expect(activePaneId()).toBe(configuredDownId);
    expect(paneLocation(workspace, defaultUpId).planeIndex).toBe(-1);
    expect(paneLocation(workspace, defaultDownId).planeIndex).toBe(0);
    expect(paneLocation(workspace, configuredDownId).planeIndex).toBe(1);
    expect(paneLocation(workspace, "source").planeIndex).toBe(2);

    await act(async () => root.unmount());
    container.remove();
  });

  it("preserves editable-control and modal guards for plane shortcuts", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const onLayoutChange = vi.fn();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "source", surfaceKind: "test", title: "Source" },
          ]}
          onLayoutChange={onLayoutChange}
          ref={workspaceRef}
          renderPane={() => (
            <>
              <input aria-label="Pane title" />
              <div aria-modal="true" role="dialog">
                <button type="button">Modal action</button>
              </div>
            </>
          )}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    onLayoutChange.mockClear();

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Pane title"]',
    );
    let editableEvent: KeyboardEvent | undefined;
    await act(async () => {
      input?.focus();
      editableEvent = dispatchKeyDown(input, {
        ctrlKey: true,
        key: "{",
        shiftKey: true,
      });
    });
    expect(editableEvent?.defaultPrevented).toBe(false);

    const modalButton = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Modal action");
    let modalEvent: KeyboardEvent | undefined;
    await act(async () => {
      modalButton?.focus();
      modalEvent = dispatchKeyDown(modalButton ?? null, {
        ctrlKey: true,
        key: "}",
        shiftKey: true,
      });
    });
    expect(modalEvent?.defaultPrevented).toBe(false);
    expect(workspace.getScene().columns).toHaveLength(1);
    expect(workspace.getSnapshot().focusedPaneId).toBe("source");
    expect(onLayoutChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("leaves overview and then a maximized pane with Escape", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={[
            { paneId: "source", surfaceKind: "test", title: "Source" },
            { paneId: "right", surfaceKind: "test", title: "Right" },
          ]}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const region = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="workspace"]',
    );
    const pressEscape = async () => {
      let event: KeyboardEvent | null = null;
      await act(async () => {
        event = dispatchKeyDown(region, { key: "Escape" });
      });
      if (!event) {
        throw new Error("Escape was not dispatched");
      }
      return event as KeyboardEvent;
    };

    expect((await pressEscape()).defaultPrevented).toBe(false);
    expect(workspace.getSnapshot().presentationMode).toBe("normal");

    await act(async () => workspace.toggleOverview());
    expect(workspace.getSnapshot().presentationMode).toBe("overview");
    expect((await pressEscape()).defaultPrevented).toBe(true);
    expect(workspace.getSnapshot().presentationMode).toBe("normal");

    const maximizeButton = requiredElement<HTMLButtonElement>(
      requiredElement(container, '[data-onirigiri-pane-id="source"]'),
      'button[aria-label="Maximize pane"]',
    );
    await act(async () => maximizeButton.click());
    expect(workspace.getSnapshot().maximizedPaneId).toBe("source");
    expect((await pressEscape()).defaultPrevented).toBe(true);
    expect(workspace.getSnapshot().maximizedPaneId).toBeNull();
    expect((await pressEscape()).defaultPrevented).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });
});

function expectRenderedPaneChromeMatchesScene(
  container: HTMLElement,
  scene: ReturnType<OnirigiriWorkspaceHandle["getScene"]>,
): void {
  const paneHosts = [
    ...container.querySelectorAll<HTMLElement>("[data-onirigiri-pane-id]"),
  ];
  const paneIds = paneHosts.map((host) => host.dataset.onirigiriPaneId);
  expect(new Set(paneIds)).toEqual(new Set(scene.paneById.keys()));
  expect(paneHosts).toHaveLength(scene.paneById.size);
  const actionStrips = [
    ...container.querySelectorAll<HTMLElement>(
      '[data-onirigiri-slot="pane-actions"]',
    ),
  ];
  expect(actionStrips).toHaveLength(paneHosts.length);
  const invalidActionStrips = actionStrips.flatMap((strip) => {
    const host = strip.closest<HTMLElement>("[data-onirigiri-pane-id]");
    const paneId = host?.dataset.onirigiriPaneId;
    const valid =
      paneId !== undefined &&
      scene.paneById.has(paneId) &&
      host?.hidden === false;
    return valid
      ? []
      : [
          {
            hidden: host?.hidden,
            paneId,
            visible: host?.dataset.visible,
          },
        ];
  });
  expect(invalidActionStrips).toEqual([]);
}

function paneIds(
  column:
    | ReturnType<OnirigiriWorkspaceHandle["getScene"]>["columns"][number]
    | undefined,
): Array<string | null> | undefined {
  return column?.cells.map((cell) => cell.paneId);
}

function dispatchKeyDown(
  target: EventTarget | null,
  init: KeyboardEventInit,
): KeyboardEvent {
  if (!target) {
    throw new Error("missing keyboard event target");
  }
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}
