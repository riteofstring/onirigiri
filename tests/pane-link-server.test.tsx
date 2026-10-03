import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OnirigiriWorkspace, onirigiriPaneHref } from "../src/index";

describe("pane links without a browser window", () => {
  it("render on the server and build relative links", () => {
    expect(typeof window).toBe("undefined");
    const markup = renderToString(
      <OnirigiriWorkspace
        initialPanes={[
          { paneId: "home", surfaceKind: "test", title: "Home" },
          { paneId: "hover", surfaceKind: "test", title: "Hover!" },
        ]}
        paneLink={{ history: "push" }}
        renderPane={(pane) => <p>{pane.title}</p>}
      />,
    );
    expect(markup).toContain('data-onirigiri-slot="workspace"');
    expect(onirigiriPaneHref("hover")).toBe("?pane=hover");
    expect(onirigiriPaneHref("hover", { base: "/tour?ref=nav#top" })).toBe(
      "/tour?ref=nav&pane=hover#top",
    );
  });
});
