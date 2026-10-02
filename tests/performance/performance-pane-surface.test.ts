// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { assertVisiblePaneSurface } from "../../bench/src/performance-pane-surface";

function overviewPane(surface: "content" | "placeholder" | "picture") {
  const workspace = document.createElement("div");
  workspace.innerHTML = `
    <article data-onirigiri-pane-id="pane-1" data-visible="true" data-runtime-state="frozen">
      <div class="onirigiri-pane__live-content" style="visibility: ${surface === "content" ? "visible" : "hidden"}">
        ${surface === "content" ? "<input value='Retained document'>" : ""}
      </div>
      <div data-onirigiri-slot="pane-placeholder" style="opacity: ${surface === "placeholder" ? "1" : "0"}">Pane 1</div>
      ${surface === "picture" ? '<img class="onirigiri-pane__picture" src="data:image/png;base64,iVBORw0KGgo=" />' : ""}
    </article>
  `;
  const image = workspace.querySelector("img");
  if (image)
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 20 },
    });
  document.body.append(workspace);
  return workspace;
}

describe("performance overview surface guard", () => {
  afterEach(() => document.body.replaceChildren());

  it.each(["content", "placeholder", "picture"] as const)(
    "accepts a frozen overview pane displaying %s",
    (surface) => {
      expect(() =>
        assertVisiblePaneSurface(overviewPane(surface)),
      ).not.toThrow();
    },
  );

  it("rejects loaded content whose pixels disappear", () => {
    const workspace = overviewPane("content");
    const content = workspace.querySelector<HTMLElement>(
      ".onirigiri-pane__live-content",
    )!;
    content.style.visibility = "hidden";
    expect(() => assertVisiblePaneSurface(workspace)).toThrow(
      "pane-1 lost its surface",
    );
  });

  it("rejects an empty visible content host when its placeholder is absent", () => {
    const workspace = overviewPane("content");
    workspace.querySelector("input")!.remove();
    expect(() => assertVisiblePaneSurface(workspace)).toThrow(
      "pane-1 lost its surface",
    );
  });

  it("rejects a cold shell whose placeholder is invisible", () => {
    const workspace = overviewPane("placeholder");
    workspace.querySelector<HTMLElement>(
      '[data-onirigiri-slot="pane-placeholder"]',
    )!.style.opacity = "0";
    expect(() => assertVisiblePaneSurface(workspace)).toThrow(
      "pane-1 lost its surface",
    );
  });

  it.each(["opacity", "display"] as const)(
    "rejects content hidden by ancestor %s",
    (property) => {
      const workspace = overviewPane("content");
      workspace.style[property] = property === "opacity" ? "0" : "none";
      expect(() => assertVisiblePaneSurface(workspace)).toThrow(
        "pane-1 lost its surface",
      );
    },
  );

  it("rejects a picture with no drawable area", () => {
    const workspace = overviewPane("picture");
    Object.defineProperty(workspace.querySelector("img")!, "naturalWidth", {
      configurable: true,
      value: 0,
    });
    expect(() => assertVisiblePaneSurface(workspace)).toThrow(
      "pane-1 lost its surface",
    );
  });

  it("rejects an overview with no visible pane surfaces", () => {
    expect(() =>
      assertVisiblePaneSurface(document.createElement("div")),
    ).toThrow("no visible pane surfaces");
  });
});
