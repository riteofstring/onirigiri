// @vitest-environment jsdom

import { act, createRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OnirigiriWorkspace,
  onirigiriPaneHref,
  type OnirigiriPaneDefinition,
  type OnirigiriWorkspaceHandle,
  type OnirigiriWorkspaceProps,
} from "../src/index";
import {
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

const panes: OnirigiriPaneDefinition[] = [
  { columnId: "home", paneId: "home", surfaceKind: "test", title: "Home" },
  { columnId: "notes", paneId: "notes", surfaceKind: "test", title: "Notes" },
  {
    columnId: "stack",
    paneId: "stack-top",
    surfaceKind: "test",
    title: "Stack top",
  },
  {
    columnId: "stack",
    paneId: "hover",
    surfaceKind: "test",
    title: "Hover!",
  },
  {
    columnId: "below",
    paneId: "below",
    planeIndex: 1,
    slotIndex: 2,
    surfaceKind: "test",
    title: "Below",
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  stubOnirigiriWorkspaceBrowserGlobals();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(
  props: Partial<OnirigiriWorkspaceProps> = {},
  strict = false,
): Promise<OnirigiriWorkspaceHandle> {
  const ref = createRef<OnirigiriWorkspaceHandle>();
  const workspace = (
    <OnirigiriWorkspace
      initialPanes={panes}
      paneLink
      ref={ref}
      renderPane={(pane) => <p>{pane.title}</p>}
      {...props}
    />
  );
  await act(async () =>
    root.render(strict ? <StrictMode>{workspace}</StrictMode> : workspace),
  );
  return requiredWorkspaceHandle(ref.current);
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

describe("pane links", () => {
  it("starts on the linked pane in any plane or split with the camera already there", async () => {
    for (const paneId of ["hover", "below"]) {
      window.history.replaceState(null, "", `/?pane=${paneId}`);
      const workspace = await mount({}, true);
      const snapshot = workspace.getSnapshot();
      expect(snapshot.focusedPaneId).toBe(paneId);
      expect(snapshot.scrollColumn).toBe(snapshot.targetScrollColumn);
      expect(snapshot.scrollRow).toBe(snapshot.targetScrollRow);
      expect(snapshot.horizontalAnchorOffset).toBe(
        snapshot.targetHorizontalAnchorOffset,
      );
      expect(snapshot.verticalAnchorOffset).toBe(
        snapshot.targetVerticalAnchorOffset,
      );
      expect(currentUrl()).toBe(`/?pane=${paneId}`);
      await act(async () => workspace.returnHome());
      expect(workspace.getSnapshot().focusedPaneId).toBe("home");
      await act(async () => root.unmount());
      root = createRoot(container);
    }
  });

  it("overrides a restored layout cursor", async () => {
    window.history.replaceState(null, "", "/?pane=notes");
    const source = await mount({ paneLink: false });
    await act(async () => source.focusPane("below"));
    const layout = source.getLayout();
    await act(async () => root.unmount());
    root = createRoot(container);

    const restored = await mount({ initialLayout: layout });
    expect(restored.getSnapshot().focusedPaneId).toBe("notes");
  });

  it("ignores unknown, oversized and control-character pane ids", async () => {
    for (const value of ["missing", "x".repeat(257), "ho%0Aver", ""]) {
      window.history.replaceState(null, "", `/?pane=${value}&keep=1`);
      const before = currentUrl();
      const workspace = await mount();
      expect(workspace.getSnapshot().focusedPaneId).toBe("home");
      expect(currentUrl()).toBe(before);
      await act(async () => root.unmount());
      root = createRoot(container);
    }
  });

  it("replaces the parameter as focus changes and keeps other parameters and the hash", async () => {
    window.history.replaceState(
      { router: "state" },
      "",
      "/docs?b=a%20b&pane=home&z=1+2#section",
    );
    const historyLength = window.history.length;
    const workspace = await mount();

    await act(async () => workspace.focusPane("hover"));
    expect(currentUrl()).toBe("/docs?b=a%20b&pane=hover&z=1+2#section");
    await act(async () => workspace.focus("right"));
    expect(workspace.getSnapshot().focusedPaneId).not.toBe("hover");
    expect(window.location.search).not.toContain("pane=hover");
    expect(window.history.length).toBe(historyLength);
    expect(window.history.state).toEqual({ router: "state" });
  });

  it("removes the parameter when focus reaches an empty cell", async () => {
    window.history.replaceState(null, "", "/?pane=below&keep=yes");
    const workspace = await mount();
    await act(async () => workspace.focus("right"));
    expect(workspace.getSnapshot().focusedPaneId).toBeNull();
    expect(currentUrl()).toBe("/?keep=yes");
  });

  it("pushes history entries on request and follows popstate", async () => {
    const workspace = await mount({
      paneLink: { history: "push", param: "window" },
    });
    const historyLength = window.history.length;
    await act(async () => workspace.focusPane("notes"));
    expect(currentUrl()).toBe("/?window=notes");
    expect(window.history.length).toBe(historyLength + 1);

    window.history.pushState(null, "", "/?window=below");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(workspace.getSnapshot().focusedPaneId).toBe("below");
    expect(currentUrl()).toBe("/?window=below");
    expect(window.history.length).toBe(historyLength + 2);

    window.history.replaceState(null, "", "/?window=missing");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(workspace.getSnapshot().focusedPaneId).toBe("below");
  });

  it("leaves the URL alone without paneLink", async () => {
    window.history.replaceState(null, "", "/?pane=hover");
    const workspace = await mount({ paneLink: undefined });
    expect(workspace.getSnapshot().focusedPaneId).toBe("home");
    await act(async () => workspace.focusPane("notes"));
    expect(currentUrl()).toBe("/?pane=hover");
  });

  it("rejects invalid options", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(mount({ paneLink: { param: "" } })).rejects.toThrow(
      "paneLink param",
    );
  });
});

describe("onirigiriPaneHref", () => {
  it("builds links that keep other parameters and the hash", () => {
    expect(
      onirigiriPaneHref("hover", {
        base: "https://example.test/tour?ref=nav&pane=home#top",
      }),
    ).toBe("https://example.test/tour?ref=nav&pane=hover#top");
    expect(
      onirigiriPaneHref("a b/c", {
        base: new URL("https://example.test/"),
        param: "view",
      }),
    ).toBe("https://example.test/?view=a%20b%2Fc");
    window.history.replaceState(null, "", "/here?x=1");
    expect(onirigiriPaneHref("notes")).toBe(
      `${window.location.origin}/here?x=1&pane=notes`,
    );
    expect(() => onirigiriPaneHref("")).toThrow("linkable pane id");
  });
});
