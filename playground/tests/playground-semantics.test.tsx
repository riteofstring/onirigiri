import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PlaygroundShortcuts } from "../shared/playground-shortcuts";
import { DemoPane } from "../shared/demo-pane";
import {
  PlaygroundCommandGroup,
  PlaygroundFrame,
} from "../shared/playground-frame";
import type { WorkspacePane } from "@riteofstring/onirigiri";

describe("playground semantics", () => {
  it.each([
    ["MacIntel", "Option + O", "Command + Z", "Option + Shift + HOME"],
    ["Win32", "Alt + O", "Ctrl + Z", "Alt + Shift + HOME"],
  ])("labels shortcut keys for %s", (platform, overview, undo, home) => {
    const platformMock = vi
      .spyOn(navigator, "platform", "get")
      .mockReturnValue(platform!);
    try {
      const container = renderMarkup(<PlaygroundShortcuts />);
      const keysFor = (label: string) =>
        [...container.querySelectorAll("dt")].find(
          (node) => node.textContent === label,
        )!.nextElementSibling!.textContent;
      expect(keysFor("Toggle overview")).toBe(overview);
      expect(keysFor("Undo")).toBe(undo);
      expect(keysFor("Return home")).toBe(home);
    } finally {
      platformMock.mockRestore();
    }
  });

  it("uses a valid heading container and labeled control group", () => {
    const container = renderMarkup(
      <PlaygroundFrame
        actions={<button type="button">Action</button>}
        guide={<p>Guide</p>}
        model="2d"
        cameraModes={{ normal: "fixed", overview: "follow" }}
        onCameraModesChange={() => undefined}
        onResizePanes={() => undefined}
        onReturnHome={() => undefined}
        onToggleOverview={() => undefined}
        presentationMode="normal"
        status="Ready"
        subtitle="Test playground"
        title="Onirigiri test"
        workspaceLabel="Test workspace"
      >
        <div>Workspace</div>
      </PlaygroundFrame>,
    );
    const heading = requiredElement<HTMLElement>(
      container,
      ".playground-brand h1",
    );

    expect(heading.parentElement?.tagName).toBe("DIV");
    expect(
      container.querySelector(
        '[role="group"][aria-label="Playground controls"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[role="group"][aria-label="Workspace navigation and display"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[role="status"][aria-label="Playground status"]',
      ),
    ).not.toBeNull();
    const themeToggle = requiredElement<HTMLButtonElement>(
      container,
      'button[aria-label="Use light mode"]',
    );
    expect(themeToggle.type).toBe("button");
    expect(themeToggle.getAttribute("aria-pressed")).toBe("false");
    const focusAnchorToggle = requiredElement<HTMLButtonElement>(
      container,
      'button[aria-label="Center focused panes"]',
    );
    expect(focusAnchorToggle.type).toBe("button");
    expect(focusAnchorToggle.getAttribute("aria-pressed")).toBe("true");
    for (const control of [themeToggle, focusAnchorToggle]) {
      const tooltipId = control.getAttribute("aria-describedby");
      expect(tooltipId).not.toBeNull();
      expect(
        container.querySelector(`[id="${tooltipId}"][role="tooltip"]`),
      ).not.toBeNull();
    }
    expect(container.querySelector('nav[aria-label="Examples"]')).toBeNull();
    expect(
      requiredElement<HTMLButtonElement>(
        container,
        'button[aria-label="Zoom out to workspace overview"]',
      ).type,
    ).toBe("button");
    expect(
      requiredElement<HTMLButtonElement>(
        container,
        'button[aria-label="Return to workspace home"]',
      ).getAttribute("aria-keyshortcuts"),
    ).toBe("Alt+Shift+Home");
    expect(
      container.querySelector(".playground-workspace-navigation"),
    ).not.toBeNull();
    expect(
      requiredElement<HTMLSelectElement>(
        container,
        'select[aria-label="D-pad action"]',
      ).value,
    ).toBe("focus");
    expect(
      requiredElement<HTMLButtonElement>(
        container,
        'button[aria-label="Keyboard shortcuts"]',
      ).getAttribute("aria-haspopup"),
    ).toBe("dialog");
    expect(
      requiredElement(
        container,
        'button[aria-label="Zoom out to workspace overview"]',
      ).closest(".playground-camera-controls"),
    ).not.toBeNull();
    const cameraModes = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Independent camera modes"]',
    );
    const normalCameraToggle = requiredElement<HTMLButtonElement>(
      cameraModes,
      'button[aria-label="Normal camera mode: Fixed. Activate to switch to Follow."]',
    );
    const overviewCameraToggle = requiredElement<HTMLButtonElement>(
      cameraModes,
      'button[aria-label="Overview camera mode: Follow. Activate to switch to Fixed."]',
    );
    expect(normalCameraToggle.type).toBe("button");
    expect(normalCameraToggle.textContent).toBe("NormalFixed");
    expect(normalCameraToggle.getAttribute("aria-pressed")).toBe("false");
    expect(overviewCameraToggle.type).toBe("button");
    expect(overviewCameraToggle.textContent).toBe("OverviewFollow");
    expect(overviewCameraToggle.getAttribute("aria-pressed")).toBe("true");
    for (const cameraToggle of [normalCameraToggle, overviewCameraToggle]) {
      const cameraTooltipId = cameraToggle.getAttribute("aria-describedby");
      expect(cameraTooltipId).not.toBeNull();
      expect(
        container.querySelector(`[id="${cameraTooltipId}"][role="tooltip"]`),
      ).not.toBeNull();
    }
    const paneSizing = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Resize all panes"]',
    );
    const paneSizingButtons =
      paneSizing.querySelectorAll<HTMLButtonElement>("button");
    expect(paneSizingButtons).toHaveLength(4);
    expect(
      [...paneSizingButtons].map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Restore default pane sizing",
      "Fit all panes to content",
      "Shrink all panes to minimum size",
      "Expand all panes to full size",
    ]);
    for (const button of paneSizingButtons) {
      expect(button.type).toBe("button");
      const tooltipId = button.getAttribute("aria-describedby");
      expect(tooltipId).not.toBeNull();
      expect(
        container.querySelector(`[id="${tooltipId}"][role="tooltip"]`),
      ).not.toBeNull();
    }
    const previewControls = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Workspace preview"]',
    );
    expect(
      requiredElement<HTMLButtonElement>(
        previewControls,
        'button[aria-label="Show desktop workspace preview"]',
      ).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      requiredElement<HTMLButtonElement>(
        previewControls,
        'button[aria-label="Show mobile workspace preview"]',
      ).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      previewControls.querySelector('[aria-label="Peek at adjacent panes"]'),
    ).toBeNull();
  });

  it("gives command clusters a visible and accessible workflow label", () => {
    const container = renderMarkup(
      <PlaygroundCommandGroup label="Split insertion and reservation">
        <button type="button">Insert as left split</button>
        <button disabled type="button">
          Remove blank below
        </button>
      </PlaygroundCommandGroup>,
    );
    const group = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Split insertion and reservation"]',
    );
    const label = requiredElement<HTMLElement>(
      group,
      ".playground-command-group__label",
    );
    const buttons = [...group.querySelectorAll<HTMLButtonElement>("button")];

    expect(label.textContent).toBe("Split insertion and reservation");
    expect(label.getAttribute("aria-hidden")).toBe("true");
    expect(buttons.map((button) => button.type)).toEqual(["button", "button"]);
    expect(buttons[1]?.disabled).toBe(true);
  });

  it("passes real compact-layout settings to preview-aware playground content", () => {
    const container = renderMarkup(
      <PlaygroundFrame
        actions={null}
        guide={null}
        model="1d"
        onResizePanes={() => undefined}
        onToggleOverview={() => undefined}
        presentationMode="normal"
        status="Ready"
        subtitle="Test playground"
        title="Onirigiri test"
        workspaceLabel="Test workspace"
      >
        {({
          compactBreakpoint,
          compactPanePeek,
          desktopControlsContainer,
          focusAnchor,
          mode,
        }) => (
          <div
            data-compact-breakpoint={compactBreakpoint}
            data-compact-pane-peek={compactPanePeek}
            data-desktop-controls={String(desktopControlsContainer !== null)}
            data-focus-anchor={focusAnchor}
            data-preview-mode={mode}
          />
        )}
      </PlaygroundFrame>,
    );
    const preview = requiredElement<HTMLElement>(
      container,
      ".playground-preview > div",
    );

    expect(preview.dataset.compactBreakpoint).toBe("0");
    expect(preview.dataset.compactPanePeek).toBe("0");
    expect(preview.dataset.desktopControls).toBe("false");
    expect(preview.dataset.focusAnchor).toBe("center");
    expect(preview.dataset.previewMode).toBe("desktop");
  });

  it("exposes the selected atlas node as button state", () => {
    const container = renderMarkup(
      <DemoPane focused={true} onChoose={() => undefined} pane={atlasPane()} />,
    );
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>(".atlas-point"),
    ];

    expect(
      buttons.map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(["true", "false", "false", "false"]);
  });
});

function renderMarkup(element: ReactNode): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(element);
  return container;
}

function requiredElement<ElementType extends Element>(
  parent: ParentNode,
  selector: string,
): ElementType {
  const element = parent.querySelector<ElementType>(selector);
  if (!element) {
    throw new Error(`Missing test element: ${selector}`);
  }
  return element;
}

function atlasPane(): WorkspacePane {
  return {
    columnId: "atlas-column",
    paneId: "atlas-pane",
    sequence: 0,
    subtitle: "",
    surfaceId: "atlas-surface",
    surfaceKind: "atlas",
    title: "Atlas",
    tone: "cyan",
  };
}
