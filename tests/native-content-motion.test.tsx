// @vitest-environment jsdom

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CooperativeFixtureFrame } from "./browser/cooperative-fixture-frame";

import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import type { OnirigiriPaneActionButtonProps } from "../src/styles/onirigiri-styling";
import type { OnirigiriWorkspaceHandle } from "../src/workspace/onirigiri-workspace-types";

import {
  requiredElement,
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

it("automated previews request headless Chrome and visible previews require an explicit option", () => {
  const probe = `
    import assert from "node:assert/strict";
    import {readFileSync} from "node:fs";
    import {pathToFileURL} from "node:url";
    import {createContext, SourceTextModule, SyntheticModule} from "node:vm";
    const context = createContext({process: {argv: []}, URL});
    const dependencies = {
      "node:url": await import("node:url"),
      "node:path": await import("node:path"),
      "../tests/browser/chrome-launch.ts": {chromeLaunchOptions: {args: []}},
      "../tests/browser/hardware-webgpu.ts": {requireHardwareWebGpu: async () => {}},
      vite: {createServer: async () => ({async listen() {}, async close() {}})},
      "@playwright/test": {chromium: {async launch(options) {
        throw new Error(options.headless ? "Headless browser startup intercepted" : "Visible browser startup intercepted");
      }}},
    };
    const module = new SourceTextModule(readFileSync(process.argv[1], "utf8"), {
      context,
      initializeImportMeta(meta) {meta.url = pathToFileURL(process.argv[1]).href;},
    });
    await module.link((specifier) => {
      const dependency = dependencies[specifier];
      assert(dependency, "Unexpected launcher dependency: " + specifier);
      return new SyntheticModule(Object.keys(dependency), function() {
        for (const [name, value] of Object.entries(dependency)) this.setExport(name, value);
      }, {context});
    });
    await module.evaluate();
    await assert.rejects(module.namespace.launchRetainedPicturePreview(), /Headless browser startup intercepted/);
    await assert.rejects(module.namespace.launchRetainedPicturePreview({headless: false}), /Visible browser startup intercepted/);
  `;
  expect(() =>
    execFileSync(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--input-type=module",
        "-e",
        probe,
        resolve("scripts/preview-retained-capture.mjs"),
      ],
      { stdio: "pipe" },
    ),
  ).not.toThrow();
});

it("browser suites intercept every explicit launch before it can open a visible window", () => {
  const probe = `
    import assert from "node:assert/strict";
    import {readFileSync} from "node:fs";
    import {extname, resolve} from "node:path";
    import {pathToFileURL} from "node:url";
    import {createContext, SourceTextModule, SyntheticModule} from "node:vm";
    import ts from "typescript";
    const context = createContext({URL});
    const cases = [];
    const test = (name, run) => cases.push({name, run});
    test.describe = (_name, register) => register();
    test.slow = () => {};
    test.setTimeout = (milliseconds) => assert(milliseconds > 0);
    test.use = (options) => assert.notEqual(options.headless, false, "A browser suite requested headed execution");
    const boundary = new Error("Browser activity intercepted");
    const stop = new Proxy({}, {get() {throw boundary;}});
    let launches = 0;
    const playwright = {chromium: {async launch(options) {
      assert.equal(options.headless, true, "An explicit browser launch must be headless");
      launches += 1;
      throw boundary;
    }}};
    const dependencies = {
      "@playwright/test": {test, expect: stop, defineConfig: (options) => options},
      "node:fs/promises": await import("node:fs/promises"),
      "node:os": await import("node:os"),
    };
    async function load(path) {
      const source = ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
      }).outputText;
      const module = new SourceTextModule(source, {
        context,
        initializeImportMeta(meta) {meta.url = pathToFileURL(path).href;},
      });
      await module.link(async (specifier) => {
        const dependency = dependencies[specifier];
        if (!dependency && specifier.startsWith(".")) return load(resolve(path, "..", extname(specifier) ? specifier : specifier + ".ts"));
        assert(dependency, "Unexpected browser suite dependency: " + specifier);
        return new SyntheticModule(Object.keys(dependency), function() {
          for (const [name, value] of Object.entries(dependency)) this.setExport(name, value);
        }, {context});
      });
      return module;
    }
    for (const file of ["playwright.config.ts", "performance.playwright.config.ts", "pane-canvas.pw.ts", "multi-video.performance.ts", "workspace-performance.performance.ts"]) {
      const module = await load(resolve("tests/browser", file));
      await module.evaluate();
      if (file.endsWith("config.ts")) {
        const config = module.namespace.default;
        assert.equal(config.use.headless, true, file + " must default to headless execution");
        for (const project of config.projects) assert.notEqual(project.use.headless, false);
      }
    }
    for (const {name, run} of cases) {
      try {
        await run({page: stop, browser: stop, playwright, baseURL: "http://localhost"}, stop);
      } catch (error) {
        if (error !== boundary) throw new Error(name, {cause: error});
      }
    }
    assert(launches > 0, "No explicit browser launches were exercised");
  `;
  execFileSync(
    process.execPath,
    ["--experimental-vm-modules", "--input-type=module", "-e", probe],
    { stdio: "pipe" },
  );
});

vi.mock("../src/pictures/pane-picture-canvas", () => ({
  createPaneCanvasDevice: async () => ({ destroy() {} }),
  PaneCanvasSurface: class {
    frameVersion = 0;
    constructor(
      _canvas: HTMLCanvasElement,
      _content: HTMLElement,
      _device: unknown,
      private callbacks: { canDraw(): boolean; drawn(value: boolean): void },
    ) {
      queueMicrotask(() => this.requestPaint());
    }
    requestPaint() {
      queueMicrotask(() => {
        if (this.callbacks.canDraw()) this.callbacks.drawn(true);
      });
    }
    dispose() {}
    clear() {
      this.callbacks.drawn(false);
    }
    setResizing() {}
    hasVideo() {
      return false;
    }
    canCapture() {
      return true;
    }
    hasCurrentFrame() {
      return true;
    }
    capture() {
      return Promise.reject(
        new Error("Capture is exercised by picture and browser contracts"),
      );
    }
  },
}));

describe("OnirigiriWorkspace native content motion", () => {
  let animationFrames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"],
    });
    stubOnirigiriWorkspaceBrowserGlobals();
    animationFrames = new Map();
    let frameSequence = 0;
    vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
      frameSequence += 1;
      animationFrames.set(frameSequence, callback);
      return frameSequence;
    });
    vi.mocked(cancelAnimationFrame).mockImplementation((frame) => {
      animationFrames.delete(frame);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resizes 100 panes without rebuilding unchanged titlebar actions", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const handle = createRef<OnirigiriWorkspaceHandle>();
    const action = vi.fn(
      ({ action: _action, ...props }: OnirigiriPaneActionButtonProps) => (
        <button {...props} />
      ),
    );
    await act(async () =>
      root.render(
        <OnirigiriWorkspace
          initialPanes={columnPanes(100, 600)}
          ref={handle}
          chromeComponents={{ PaneActionButton: action }}
          renderPane={() => <input defaultValue="Preserved" />}
        />,
      ),
    );
    const pane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-slot="pane"]',
    );
    const width = pane.style.width;
    const input = requiredElement<HTMLInputElement>(pane, "input");
    input.value = "Edited before resizing";
    action.mockClear();
    await act(async () =>
      requiredWorkspaceHandle(handle.current).resizePanes("minimum"),
    );
    expect(pane.style.width).not.toBe(width);
    expect(action).not.toHaveBeenCalled();
    expect(requiredElement(pane, "input")).toBe(input);
    expect(input.value).toBe("Edited before resizing");
    expect(
      Array.from(
        pane.querySelectorAll('[data-onirigiri-slot="pane-actions"] button'),
        (button) => button.getAttribute("aria-label"),
      ),
    ).toEqual(["Maximize pane", "Close pane"]);

    expect(
      container.querySelectorAll('[data-onirigiri-slot="pane"]'),
    ).toHaveLength(100);
    await act(async () => root.unmount());
    container.remove();
  });

  it.each(["load", "ready"])(
    "covers a loading fixture until both load and readiness arrive, starting with %s",
    async (first) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const src = "https://fixture.example/pane";
      await act(async () => {
        root.render(
          <OnirigiriWorkspace
            initialPanes={columnPanes(1, 600)}
            renderPane={() => (
              <CooperativeFixtureFrame
                protocol="fixture/v1"
                runtime="live"
                src={src}
                title="Loading pane"
              />
            )}
          />,
        );
      });
      const frame = requiredElement<HTMLIFrameElement>(container, "iframe");
      const signal = async (type: string) =>
        act(async () => {
          if (type === "load") frame.dispatchEvent(new Event("load"));
          else
            window.dispatchEvent(
              new MessageEvent("message", {
                origin: "https://fixture.example",
                source: frame.contentWindow,
                data: { protocol: "fixture/v1", type: "ready" },
              }),
            );
        });
      expect(
        container.querySelector('[data-onirigiri-content-ready="false"]'),
      ).not.toBeNull();
      expect(
        container.querySelector(".onirigiri-pane__placeholder svg"),
      ).not.toBeNull();
      await signal(first);
      expect(
        container.querySelector('[data-onirigiri-content-ready="false"]'),
      ).not.toBeNull();
      await signal(first === "load" ? "ready" : "load");
      expect(
        container.querySelector('[data-onirigiri-content-ready="true"]'),
      ).not.toBeNull();
      expect(
        container.querySelector(".onirigiri-pane__placeholder"),
      ).toBeNull();
      await act(async () => root.unmount());
      container.remove();
    },
  );

  it("updates a fixture theme only when appearance changes, independently of runtime commands", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let themeApplications = 0;
    const render = async (
      runtime: string,
      colorMode: "light" | "dark" = "light",
    ) =>
      act(async () => {
        root.render(
          <OnirigiriWorkspace
            initialPanes={columnPanes(1, 600)}
            renderPane={() => (
              <CooperativeFixtureFrame
                protocol="fixture/v1"
                runtime={runtime}
                src="https://fixture.example/pane"
                theme={{
                  colorMode,
                  styles: { surface: colorMode === "light" ? "#fff" : "#111" },
                }}
                title="Themed pane"
              />
            )}
          />,
        );
      });
    await render("live");
    const frame = requiredElement<HTMLIFrameElement>(container, "iframe");
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(
      (message) => {
        if (message.command !== "theme") return;
        themeApplications++;
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://fixture.example",
            source: frame.contentWindow,
            data: {
              protocol: "fixture/v1",
              type: "theme-applied",
              requestId: message.requestId,
            },
          }),
        );
      },
    );
    await act(async () => {
      frame.dispatchEvent(new Event("load"));
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://fixture.example",
          source: frame.contentWindow,
          data: { protocol: "fixture/v1", type: "ready" },
        }),
      );
    });
    expect(frame.dataset.consumerReady).toBe("true");
    expect(themeApplications).toBe(1);
    for (const runtime of ["frozen", "hidden", "live", "frozen", "live"])
      await render(runtime);
    expect(themeApplications).toBe(1);
    await render("live", "dark");
    expect(themeApplications).toBe(2);
    expect(container.querySelector("iframe")).toBe(frame);
    expect(frame.dataset.consumerReady).toBe("true");
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps every shell and title mounted before visits and after content eviction", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const ref = createRef<OnirigiriWorkspaceHandle>();
    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={columnPanes(12, 600)}
          ref={ref}
          retainedAreaBudgetViewports={1}
          renderPane={(pane) => <input data-consumer={pane.paneId} />}
        />,
      );
    });
    const shells = [
      ...container.querySelectorAll<HTMLElement>(".onirigiri-pane"),
    ];
    expect(shells).toHaveLength(12);
    const cold = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-12"]',
    );
    expect(cold.hidden).toBe(false);
    expect(cold.style.opacity).toBe("1");
    expect(cold.querySelector(".onirigiri-pane__heading")?.textContent).toBe(
      "Pane 12",
    );
    expect(
      cold.querySelector(".onirigiri-pane__placeholder svg"),
    ).not.toBeNull();
    expect(cold.querySelector("input")).toBeNull();
    const workspace = requiredWorkspaceHandle(ref.current);
    await act(async () => {
      workspace.focusPane("pane-12");
    });
    await flushAnimationFrames(animationFrames);
    expect(cold.querySelector("input")).not.toBeNull();
    await act(async () => {
      workspace.focusPane("pane-1");
    });
    await flushAnimationFrames(animationFrames);
    expect(cold.querySelector("input")).toBeNull();
    expect([...container.querySelectorAll(".onirigiri-pane")]).toEqual(shells);
    for (const shell of shells) {
      expect(shell.hidden).toBe(false);
      expect(shell.style.opacity).toBe("1");
    }
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps one retained iframe and its form state through motion and a paused overview", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    const renderCounts = new Map<string, number>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          initialPanes={columnPanes(3, 520)}
          ref={workspaceRef}
          renderPane={(pane, state) => {
            renderCounts.set(
              pane.paneId,
              (renderCounts.get(pane.paneId) ?? 0) + 1,
            );
            return (
              <div
                data-consumer={pane.paneId}
                data-consumer-state={state.runtimeState}
              >
                <iframe data-frame={pane.paneId} title={pane.title} />
                <input data-field={pane.paneId} defaultValue="" />
              </div>
            );
          }}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const frame = requiredElement<HTMLIFrameElement>(
      container,
      '[data-frame="pane-1"]',
    );
    const field = requiredElement<HTMLInputElement>(
      container,
      '[data-field="pane-1"]',
    );
    field.value = "typed before motion";
    frame.contentDocument?.body.setAttribute("data-marker", "retained");
    const liveContent = requiredElement<HTMLElement>(
      requiredElement<HTMLElement>(
        container,
        '[data-onirigiri-pane-id="pane-1"]',
      ),
      ".onirigiri-pane__live-content",
    );

    expect(liveContent.hasAttribute("inert")).toBe(false);

    await act(async () => {
      expect(workspace.focusPane("pane-3")).toBe(true);
    });
    expect(workspace.getSnapshot().scrollColumn).not.toBe(
      workspace.getSnapshot().targetScrollColumn,
    );
    const rendersAtRequestBoundary = renderCounts.get("pane-1") ?? 0;
    const framesBeforeSettle = animationFrames.size;
    await flushAnimationFrames(animationFrames);
    expect(framesBeforeSettle).toBeGreaterThan(0);
    expect(renderCounts.get("pane-1")).toBeLessThanOrEqual(
      rendersAtRequestBoundary + 3,
    );

    await act(async () => workspace.toggleOverview());
    await flushAnimationFrames(animationFrames);
    expect(workspace.getSnapshot().presentationMode).toBe("overview");
    const overviewPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-1"]',
    );
    expect(overviewPane.dataset.runtimeState).toBe("frozen");
    expect(
      requiredElement<HTMLElement>(
        container,
        '[data-frame="pane-1"]',
      ).isSameNode(frame),
    ).toBe(true);
    expect(liveContent.hasAttribute("inert")).toBe(true);
    expect(liveContent.getAttribute("aria-hidden")).toBe("true");
    expect(
      requiredElement<HTMLElement>(overviewPane, ".onirigiri-pane__content")
        .dataset.onirigiriPlaceholderOnly,
    ).toBe("false");

    await act(async () => workspace.toggleOverview());
    await flushAnimationFrames(animationFrames);
    await act(async () => {
      expect(workspace.focusPane("pane-1")).toBe(true);
    });
    await flushAnimationFrames(animationFrames);

    const settledFrame = requiredElement<HTMLIFrameElement>(
      container,
      '[data-frame="pane-1"]',
    );
    expect(settledFrame.isSameNode(frame)).toBe(true);
    expect(settledFrame.contentDocument?.body.dataset.marker).toBe("retained");
    expect(
      requiredElement<HTMLInputElement>(container, '[data-field="pane-1"]')
        .value,
    ).toBe("typed before motion");
    const settledPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-1"]',
    );
    expect(settledPane.dataset.runtimeState).toBe("live");
    expect(settledPane.dataset.visible).toBe("true");
    expect(liveContent.hasAttribute("inert")).toBe(false);
    expect(liveContent.getAttribute("aria-hidden")).toBe("false");

    await act(async () => root.unmount());
    container.remove();
  });

  it("mounts cold unfocused destination entrants during motion without mounting the corridor", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          compactBreakpoint={0}
          initialPanes={columnPanes(12, 600)}
          ref={workspaceRef}
          renderPane={(pane) => <div data-consumer={pane.paneId} />}
          retainedAreaBudgetViewports={1}
          showControls={false}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    expect(container.querySelector('[data-consumer="pane-9"]')).toBeNull();
    expect(container.querySelector('[data-consumer="pane-10"]')).toBeNull();

    await act(async () => {
      expect(workspace.focusPane("pane-9")).toBe(true);
    });
    expect(workspace.getSnapshot().scrollColumn).not.toBe(
      workspace.getSnapshot().targetScrollColumn,
    );

    for (const paneId of ["pane-8", "pane-9", "pane-10"]) {
      const pane = requiredElement<HTMLElement>(
        container,
        `[data-onirigiri-pane-id="${paneId}"]`,
      );
      expect(pane.dataset.moving).toBe("true");
      expect(pane.dataset.focused).toBe(String(paneId === "pane-9"));
      expect(
        requiredElement<HTMLElement>(pane, ".onirigiri-pane__content").dataset
          .onirigiriPlaceholderOnly,
      ).toBe("false");
      expect(pane.querySelector(`[data-consumer="${paneId}"]`)).not.toBeNull();
    }
    const corridorPane = requiredElement<HTMLElement>(
      container,
      '[data-onirigiri-pane-id="pane-5"]',
    );
    expect(
      requiredElement<HTMLElement>(corridorPane, ".onirigiri-pane__content")
        .dataset.onirigiriPlaceholderOnly,
    ).toBe("true");
    expect(corridorPane.querySelector('[data-consumer="pane-5"]')).toBeNull();
    expect(
      requiredElement<HTMLElement>(
        corridorPane,
        '[data-onirigiri-slot="pane-placeholder"]',
      ).textContent,
    ).toBe("Pane 5");

    await flushAnimationFrames(animationFrames);
    const settledPanes = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-onirigiri-pane-id][data-visible="true"]',
      ),
    ];
    expect(
      settledPanes.map((pane) => pane.dataset.onirigiriPaneId).sort(),
    ).toEqual(["pane-10", "pane-8", "pane-9"]);
    for (const pane of settledPanes) {
      expect(pane.dataset.runtimeState).toBe("live");
      expect(
        requiredElement<HTMLElement>(pane, ".onirigiri-pane__content").dataset
          .onirigiriPlaceholderOnly,
      ).toBe("false");
      expect(
        requiredElement<HTMLElement>(
          pane,
          ".onirigiri-pane__live-content",
        ).hasAttribute("inert"),
      ).toBe(false);
    }

    await act(async () => root.unmount());
    container.remove();
  });

  it("leaves cold overview content unmounted when preloading is disabled", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          compactBreakpoint={0}
          initialPanes={gridPanes(20, 6, 180)}
          preloadMarginPanes={0}
          ref={workspaceRef}
          renderPane={(pane) => (
            <iframe data-consumer={pane.paneId} title={pane.title} />
          )}
          retainedAreaBudgetViewports={1}
          showControls={false}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    const warm = [
      ...container.querySelectorAll<HTMLElement>("[data-consumer]"),
    ];
    expect(warm.length).toBeGreaterThan(0);
    await act(async () => workspace.toggleOverview());
    await flushAnimationFrames(animationFrames);
    for (const frame of container.querySelectorAll<HTMLElement>(
      "[data-consumer]",
    )) {
      expect(warm).toContain(frame);
    }
    const destination = "pane-91";
    expect(warm.some((frame) => frame.dataset.consumer === destination)).toBe(
      false,
    );
    await act(async () => workspace.focusPane(destination));
    await flushAnimationFrames(animationFrames);
    const cold = requiredElement<HTMLElement>(
      container,
      `[data-onirigiri-pane-id="${destination}"]`,
    );
    expect(cold.dataset.visible).toBe("true");
    expect(
      requiredElement<HTMLElement>(cold, ".onirigiri-pane__content").dataset
        .onirigiriPlaceholderOnly,
    ).toBe("true");
    expect(
      container.querySelector(`[data-consumer="${destination}"]`),
    ).toBeNull();
    await act(async () => workspace.toggleOverview());
    expect(
      container.querySelector(`[data-consumer="${destination}"]`),
    ).not.toBeNull();
    await flushAnimationFrames(animationFrames);
    for (const pane of container.querySelectorAll<HTMLElement>(
      '[data-onirigiri-pane-id][data-visible="true"]',
    )) {
      expect(pane.dataset.runtimeState).toBe("live");
      expect(pane.querySelector("[data-consumer]")).not.toBeNull();
    }
    await act(async () => root.unmount());
    container.remove();
  });

  it("retains loaded iframe documents through rapid overview navigation", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();
    try {
      await act(async () => {
        root.render(
          <OnirigiriWorkspace
            compactBreakpoint={0}
            initialPanes={columnPanes(50, 520)}
            ref={workspaceRef}
            renderPane={(pane) => (
              <iframe data-consumer={pane.paneId} title={pane.title} />
            )}
            retainedAreaBudgetViewports={2}
            showControls={false}
          />,
        );
      });
      const workspace = requiredWorkspaceHandle(workspaceRef.current);
      await flushAnimationFrames(animationFrames);
      const warm = [...container.querySelectorAll<HTMLIFrameElement>("iframe")];
      expect(warm.length).toBeGreaterThan(1);
      const original = requiredElement<HTMLIFrameElement>(
        container,
        '[data-consumer="pane-1"]',
      );
      const documentBefore = original.contentDocument;
      expect(documentBefore).not.toBeNull();
      documentBefore!.body.dataset.savedState = "kept through navigation";

      await act(async () => workspace.toggleOverview());
      await flushAnimationFrames(animationFrames);
      for (const destination of ["pane-25", "pane-40", "pane-15"]) {
        await act(async () => {
          expect(workspace.focusPane(destination)).toBe(true);
        });
        await flushAnimationFrames(animationFrames, 3);
      }
      await flushAnimationFrames(animationFrames);
      for (const frame of warm) {
        expect(frame.isConnected, frame.dataset.consumer).toBe(true);
      }

      await act(async () => workspace.focusPane("pane-1"));
      await flushAnimationFrames(animationFrames);
      await act(async () => workspace.toggleOverview());
      await flushAnimationFrames(animationFrames);
      expect(container.querySelector('[data-consumer="pane-1"]')).toBe(
        original,
      );
      expect(original.contentDocument).toBe(documentBefore);
      expect(original.contentDocument!.body.dataset.savedState).toBe(
        "kept through navigation",
      );
      for (const pane of container.querySelectorAll<HTMLElement>(
        '[data-onirigiri-pane-id][data-visible="true"]',
      )) {
        expect(pane.dataset.runtimeState).toBe("live");
        expect(pane.querySelector("iframe")).not.toBeNull();
        expect(
          pane
            .querySelector('[data-onirigiri-slot="pane-live-content"]')
            ?.hasAttribute("inert"),
        ).toBe(false);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("recovers live content when an overview entry is interrupted before it settles", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          compactBreakpoint={0}
          initialPanes={columnPanes(12, 600)}
          ref={workspaceRef}
          renderPane={(pane) => <div data-consumer={pane.paneId} />}
          retainedAreaBudgetViewports={1}
          showControls={false}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);

    await act(async () => workspace.toggleOverview());
    await flushAnimationFrames(animationFrames, 3);
    const interruptedSnapshot = workspace.getSnapshot();
    expect(interruptedSnapshot.presentationMode).toBe("overview");
    expect(interruptedSnapshot.overviewProgress).toBeGreaterThan(0);
    expect(interruptedSnapshot.overviewProgress).toBeLessThan(1);

    await act(async () => workspace.toggleOverview());
    expect(workspace.getSnapshot().presentationMode).toBe("normal");
    for (const paneId of ["pane-1", "pane-2"]) {
      const pane = requiredElement<HTMLElement>(
        container,
        `[data-onirigiri-pane-id="${paneId}"]`,
      );
      expect(pane.dataset.moving).toBe("true");
      expect(
        requiredElement<HTMLElement>(pane, ".onirigiri-pane__content").dataset
          .onirigiriPlaceholderOnly,
      ).toBe("false");
      expect(pane.querySelector(`[data-consumer="${paneId}"]`)).not.toBeNull();
    }

    await flushAnimationFrames(animationFrames);
    expect(workspace.getSnapshot().overviewProgress).toBe(0);
    const settledPanes = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-onirigiri-pane-id][data-visible="true"]',
      ),
    ];
    expect(settledPanes.map((pane) => pane.dataset.onirigiriPaneId)).toEqual([
      "pane-1",
      "pane-2",
    ]);
    for (const pane of settledPanes) {
      expect(pane.dataset.moving).toBe("false");
      expect(pane.dataset.runtimeState).toBe("live");
      expect(
        requiredElement<HTMLElement>(pane, ".onirigiri-pane__content").dataset
          .onirigiriPlaceholderOnly,
      ).toBe("false");
      expect(
        requiredElement<HTMLElement>(
          pane,
          ".onirigiri-pane__live-content",
        ).hasAttribute("inert"),
      ).toBe(false);
    }
    expect(
      container.querySelectorAll(
        '[data-onirigiri-pane-id][data-runtime-state="frozen"]',
      ),
    ).toHaveLength(0);

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps every intersecting pane live at normal rest and paused in overview with 50+ visible panes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspaceRef = createRef<OnirigiriWorkspaceHandle>();

    await act(async () => {
      root.render(
        <OnirigiriWorkspace
          compactBreakpoint={0}
          initialPanes={gridPanes(11, 7, 96)}
          ref={workspaceRef}
          renderPane={(pane) => <div data-consumer={pane.paneId} />}
          showControls={false}
        />,
      );
    });
    const workspace = requiredWorkspaceHandle(workspaceRef.current);
    await act(async () => {
      expect(workspace.focusPane("pane-39")).toBe(true);
    });
    await flushAnimationFrames(animationFrames);

    const restPanes = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-onirigiri-pane-id][data-visible="true"]',
      ),
    ];
    expect(restPanes.length).toBeGreaterThanOrEqual(50);
    for (const pane of restPanes) {
      expect(pane.dataset.runtimeState).toBe("live");
      expect(
        requiredElement<HTMLElement>(pane, ".onirigiri-pane__content").dataset
          .onirigiriPlaceholderOnly,
      ).toBe("false");
      expect(
        pane.querySelector(`[data-consumer="${pane.dataset.onirigiriPaneId}"]`),
      ).not.toBeNull();
      const liveContent = requiredElement<HTMLElement>(
        pane,
        ".onirigiri-pane__live-content",
      );
      expect(liveContent.hasAttribute("inert")).toBe(false);
      expect(liveContent.getAttribute("aria-hidden")).toBe("false");
    }

    await act(async () => workspace.toggleOverview());
    await flushAnimationFrames(animationFrames);
    expect(workspace.getSnapshot().presentationMode).toBe("overview");
    const overviewPanes = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-onirigiri-pane-id][data-visible="true"]',
      ),
    ];
    expect(overviewPanes.length).toBeGreaterThanOrEqual(restPanes.length);
    for (const pane of overviewPanes) {
      expect(pane.dataset.runtimeState).toBe("frozen");
      expect(
        requiredElement<HTMLElement>(
          pane,
          ".onirigiri-pane__live-content",
        ).hasAttribute("inert"),
      ).toBe(true);
    }

    await act(async () => root.unmount());
    container.remove();
  }, 20_000);
});

function columnPanes(count: number, width: number) {
  return Array.from({ length: count }, (_, index) => ({
    columnId: `column-${index + 1}`,
    columnWidth: { unit: "px" as const, value: width },
    paneId: `pane-${index + 1}`,
    slotIndex: index,
    surfaceKind: "test",
    title: `Pane ${index + 1}`,
  }));
}

function gridPanes(columns: number, rows: number, size: number) {
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = Math.floor(index / rows);
    return {
      columnId: `column-${column + 1}`,
      columnWidth: { unit: "px" as const, value: size },
      heightPx: size,
      paneId: `pane-${index + 1}`,
      slotIndex: column,
      surfaceKind: "test",
      title: `Pane ${index + 1}`,
    };
  });
}

async function flushAnimationFrames(
  animationFrames: Map<number, FrameRequestCallback>,
  frameLimit = 240,
): Promise<void> {
  for (
    let frame = 0;
    frame < frameLimit && animationFrames.size > 0;
    frame += 1
  ) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16.67);
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of callbacks) {
        callback(performance.now());
      }
    });
  }
  if (frameLimit >= 240) {
    expect(animationFrames.size).toBe(0);
  }
}
