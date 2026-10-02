import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OnirigiriWorkspace,
  defineOnirigiriChromeComponents,
  type OnirigiriPaneActionButtonProps,
  type OnirigiriPaneActionDescriptor,
  type OnirigiriShortcutBindings,
  type OnirigiriWorkspaceControlButtonProps,
  type OnirigiriWorkspaceControlDescriptor,
  type OnirigiriWorkspaceHandle,
} from "../src/index";

import {
  requiredElement,
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

const panes = [
  {
    columnId: "source-column",
    paneId: "source",
    surfaceKind: "test",
    title: "Source",
  },
  {
    columnId: "right-column",
    paneId: "right",
    surfaceKind: "test",
    title: "Right",
  },
];

const shortcuts = {
  focusRight: [
    {
      altKey: true,
      ctrlKey: false,
      key: "ArrowRight",
      metaKey: false,
      shiftKey: false,
    },
    { altKey: false, ctrlKey: true, key: "d", metaKey: true, shiftKey: true },
  ],
} satisfies OnirigiriShortcutBindings;

describe("Onirigiri chrome component descriptors", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("gives workspace control overrides typed descriptors and working button props", async () => {
    const controls = new Map<string, OnirigiriWorkspaceControlDescriptor>();
    function HostControlButton({
      control,
      ...buttonProps
    }: OnirigiriWorkspaceControlButtonProps) {
      controls.set(control.id, control);
      return (
        <span data-host-tooltip-root={control.id}>
          <button {...buttonProps} data-host-button="true" />
          <span data-host-tooltip-content>{control.label}</span>
        </span>
      );
    }
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () =>
      root.render(
        <OnirigiriWorkspace
          chromeComponents={defineOnirigiriChromeComponents({
            WorkspaceControlButton: HostControlButton,
          })}
          gridAxes="horizontal"
          initialPanes={panes}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
          shortcuts={shortcuts}
        />,
      ),
    );
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const hostButton = (id: string) =>
      requiredElement<HTMLButtonElement>(
        container,
        `[data-host-tooltip-root="${id}"] button[data-host-button="true"]`,
      );

    expect(controls.get("overview")).toEqual({
      action: "toggleOverview",
      available: true,
      id: "overview",
      label: "Open workspace overview",
      pressed: false,
      shortcuts: [
        {
          aria: "Alt+O",
          binding: {
            altKey: true,
            ctrlKey: false,
            key: "o",
            metaKey: false,
            shiftKey: false,
          },
          keys: ["⌥ Option", "O"],
          label: "⌥ Option + O",
        },
      ],
    });
    expect(controls.get("move-right")).toEqual({
      action: "focusRight",
      available: true,
      id: "move-right",
      label: "Move cursor right",
      shortcuts: [
        {
          aria: "Alt+ArrowRight",
          binding: shortcuts.focusRight[0],
          keys: ["⌥ Option", "→"],
          label: "⌥ Option + →",
        },
        {
          aria: "Control+Shift+Meta+D",
          binding: shortcuts.focusRight[1],
          keys: ["⌃ Control", "⇧ Shift", "⌘ Command", "D"],
          label: "⌃ Control + ⇧ Shift + ⌘ Command + D",
        },
      ],
    });
    expect(controls.get("move-up")).toMatchObject({
      action: "focusUp",
      available: false,
      label: "Move cursor up",
    });
    expect(hostButton("move-right").getAttribute("aria-keyshortcuts")).toBe(
      "Alt+ArrowRight Control+Shift+Meta+D",
    );
    expect(hostButton("move-right").dataset.onirigiriControl).toBe(
      "move-right",
    );
    expect(hostButton("move-right").querySelector("svg")).not.toBeNull();
    expect(hostButton("move-up").getAttribute("aria-disabled")).toBe("true");
    expect(container.querySelector('[role="tooltip"]')).toBeNull();

    await act(async () => hostButton("move-up").click());
    expect(workspace.getSnapshot().focusedPaneId).toBe("source");
    await act(async () => hostButton("move-right").click());
    expect(workspace.getSnapshot().focusedPaneId).toBe("right");
    await act(async () => hostButton("overview").click());
    expect(workspace.getSnapshot().presentationMode).toBe("overview");
    expect(controls.get("overview")).toMatchObject({
      label: "Exit workspace overview",
      pressed: true,
    });
    expect(hostButton("overview").getAttribute("aria-pressed")).toBe("true");
  });

  it("omits pane actions whose override returns null and runs the others", async () => {
    const actions: OnirigiriPaneActionDescriptor[] = [];
    function HostPaneAction({
      action,
      ...buttonProps
    }: OnirigiriPaneActionButtonProps) {
      actions.push(action);
      if (action.id === "maximize") {
        return null;
      }
      return <button {...buttonProps} data-host-action={action.id} />;
    }
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () =>
      root.render(
        <OnirigiriWorkspace
          chromeComponents={{ PaneActionButton: HostPaneAction }}
          initialPanes={panes}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      ),
    );
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const rightActions = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="right"] [data-onirigiri-slot="pane-actions"]',
    );

    expect(
      [...rightActions.querySelectorAll("button")].map((button) => [
        button.dataset.onirigiriPaneAction,
        button.getAttribute("aria-label"),
      ]),
    ).toEqual([["close", "Close pane"]]);
    expect(
      actions
        .filter(({ pane }) => pane.paneId === "right")
        .map(({ id, label }) => [id, label]),
    ).toEqual(
      expect.arrayContaining([
        ["maximize", "Maximize pane"],
        ["close", "Close pane"],
      ]),
    );

    await act(async () =>
      requiredElement<HTMLButtonElement>(
        rightActions,
        '[data-host-action="close"]',
      ).click(),
    );
    expect(workspace.getScene().paneById.has("right")).toBe(false);
  });

  it("describes the restore action after a pane override maximizes", async () => {
    const actionIds = new Map<string, string>();
    function HostPaneAction({
      action,
      ...buttonProps
    }: OnirigiriPaneActionButtonProps) {
      if (action.id !== "close") {
        actionIds.set(action.pane.paneId, action.id);
      }
      return <button {...buttonProps} data-host-action={action.id} />;
    }
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () =>
      root.render(
        <OnirigiriWorkspace
          chromeComponents={{ PaneActionButton: HostPaneAction }}
          initialPanes={panes}
          ref={workspaceRef}
          renderPane={() => <div>Test content</div>}
        />,
      ),
    );
    const maximize = requiredElement<HTMLButtonElement>(
      container,
      '[data-onirigiri-pane-id="right"] [data-host-action="maximize"]',
    );
    expect(maximize.getAttribute("aria-label")).toBe("Maximize pane");
    expect(maximize.hasAttribute("title")).toBe(false);

    await act(async () => maximize.click());
    expect(
      requiredWorkspaceHandle(workspaceRef.current).getSnapshot()
        .maximizedPaneId,
    ).toBe("right");
    expect(actionIds.get("right")).toBe("restore");
    expect(
      requiredElement<HTMLButtonElement>(
        container,
        '[data-onirigiri-pane-id="right"] [data-host-action="restore"]',
      ).getAttribute("aria-label"),
    ).toBe("Restore pane");
  });
});
