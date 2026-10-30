import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnirigiriPaneContent } from "../../src/panes/onirigiri-pane-content";
import type { PanePresentationState } from "../../src/presentation/pane-presentation-policy";
import { OnirigiriWorkspace } from "../../src/workspace/OnirigiriWorkspace";
import {
  editorPane,
  panePicturesStub,
  requiredElement,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "../onirigiri-workspace-test-support";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  stubOnirigiriWorkspaceBrowserGlobals();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("updates continuous presentation after configuration without replacing content", async () => {
  const panes = [{ paneId: "editor", title: "Editor", surfaceKind: "editor" }];
  const renderPane = () => <input aria-label="Draft" />;
  const render = async (liveContent: boolean) => {
    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={panes}
          liveContent={liveContent}
          renderPane={renderPane}
        />,
      );
    });
  };

  await render(true);
  const content = requiredElement<HTMLElement>(
    container,
    '[data-onirigiri-slot="pane-content"]',
  );
  const input = requiredElement<HTMLInputElement>(container, "input");
  input.value = "Keep this draft";
  expect(content.dataset.onirigiriContinuous).toBe("true");

  for (const liveContent of [false, true]) {
    await render(liveContent);
    expect(content.dataset.onirigiriContinuous).toBe(String(liveContent));
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("Keep this draft");
  }
});

it.each([false, true])(
  "updates retained placeholder input across motion when initially moving=%s",
  async (initiallyMoving) => {
    let moving = initiallyMoving;
    const presentation: PanePresentationState = {
      requested: "placeholder",
      kind: "placeholder",
      detail: "full",
      variant: "saved",
      reason: "developer-policy",
      actual: "placeholder",
      covered: true,
      live: false,
    };
    const { pictures, notify } = panePicturesStub({
      isLive: () => false,
      isInteractive: () => !moving,
      isDrawn: () => false,
      getPaneError: () => null,
      getPresentation: () => presentation,
    });
    const clicked = vi.fn();
    await act(async () => {
      root.render(
        <OnirigiriPaneContent
          focused
          maximized={false}
          pictures={pictures}
          picture={null}
          pane={editorPane}
          placeholderOnly={false}
          presentationMode="normal"
          renderPane={() => <input aria-label="Retained draft" />}
          renderPanePlaceholder={() => (
            <button onClick={clicked}>Open saved pane</button>
          )}
          runtimeState="frozen"
          settledVisible
          visible
        />,
      );
    });
    const placeholder = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="pane-placeholder"]',
    );
    const button = requiredElement<HTMLButtonElement>(placeholder, "button");
    const input = requiredElement<HTMLInputElement>(container, "input");
    input.value = "Keep the retained draft";
    expect(placeholder.hasAttribute("inert")).toBe(initiallyMoving);
    for (const next of [!initiallyMoving, initiallyMoving, false]) {
      await act(async () => {
        moving = next;
        notify();
      });
      expect(placeholder.hasAttribute("inert")).toBe(next);
      expect(placeholder.dataset.onirigiriPlaceholderInteractive).toBe(
        String(!next),
      );
      expect(container.querySelector("button")).toBe(button);
      expect(container.querySelector("input")).toBe(input);
      expect(input.value).toBe("Keep the retained draft");
    }
    await act(async () => button.click());
    expect(clicked).toHaveBeenCalledOnce();
  },
);
