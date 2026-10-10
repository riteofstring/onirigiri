import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnirigiriWorkspace } from "../../src/workspace/OnirigiriWorkspace";
import {
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
