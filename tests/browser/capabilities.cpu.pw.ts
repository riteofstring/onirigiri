import { expect, test } from "@playwright/test";
import { build } from "vite";
import { browserGraphicsCapabilities } from "../performance/browser-environment";

let source: string;

test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: new URL(
          "../../src/panes/pane-content-capabilities.ts",
          import.meta.url,
        ).pathname,
        name: "capabilityInventory",
        formats: ["iife"],
      },
    },
  });
  const bundle = Array.isArray(result) ? result[0]! : result;
  if (!("output" in bundle)) throw new Error("Expected capability bundle");
  const chunk = bundle.output.find((item) => item.type === "chunk");
  if (!chunk) throw new Error("Missing capability bundle");
  source = chunk.code;
});

test.beforeEach(async ({ page }) => {
  await page.setContent("<!doctype html><section id='content'></section>");
  await page.addScriptTag({ content: source });
});

test("synchronous DOM changes invalidate capabilities before the next query", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const api = Reflect.get(window, "capabilityInventory");
    const root = document.querySelector("section")!;
    const inventory = new api.PaneContentCapabilities(root, () => undefined);
    try {
      const states = [inventory.canCapture()];
      const canvas = document.createElement("canvas");
      root.append(canvas);
      states.push(inventory.canCapture());
      const video = document.createElement("video");
      canvas.replaceWith(video);
      states.push(
        inventory.canCapture(),
        inventory.hasVideo(),
        inventory.videoElements()[0] === video,
      );
      Object.defineProperty(video, "mediaKeys", {
        configurable: true,
        value: {},
      });
      states.push(inventory.canCapture());
      Object.defineProperty(video, "mediaKeys", { value: null });
      states.push(inventory.canCapture());
      video.remove();
      states.push(inventory.canCapture(), inventory.hasVideo());
      return states;
    } finally {
      inventory.dispose();
    }
  });
  expect(result).toEqual([
    true,
    false,
    true,
    true,
    true,
    false,
    true,
    true,
    false,
  ]);
});

test("text churn does not rescan the pane or notify capability changes", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = Reflect.get(window, "capabilityInventory");
    const root = document.querySelector("section")!;
    root.innerHTML = "<div><span>terminal output</span></div>";
    let changes = 0;
    const inventory = new api.PaneContentCapabilities(root, () => changes++);
    inventory.canCapture();
    let scans = 0;
    const query = root.querySelectorAll.bind(root);
    Reflect.set(root, "querySelectorAll", (selector: string) => {
      scans++;
      return query(selector);
    });
    try {
      let capturable = true;
      for (let index = 0; index < 100; index++) {
        root.firstElementChild!.innerHTML = `<span>${index}</span>`;
        capturable &&= inventory.canCapture();
        await Promise.resolve();
      }
      return { scans, changes, capturable };
    } finally {
      inventory.dispose();
    }
  });
  expect(result).toEqual({ scans: 0, changes: 0, capturable: true });
});

test("iframe navigation and nested mutation refresh document identities and detach old observers", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = Reflect.get(window, "capabilityInventory");
    const root = document.querySelector("section")!;
    const frame = document.createElement("iframe");
    root.append(frame);
    let changes = 0;
    const inventory = new api.PaneContentCapabilities(root, () => changes++);
    try {
      const oldDocument = frame.contentDocument!;
      const initial = inventory.iframeDocuments().has(oldDocument);
      await new Promise<void>((resolve) => {
        frame.addEventListener("load", () => resolve(), { once: true });
        frame.srcdoc = "<!doctype html><video></video>";
      });
      const current = frame.contentDocument!;
      const navigated =
        !inventory.iframeDocuments().has(oldDocument) &&
        inventory.iframeDocuments().has(current);
      const video = inventory.hasVideo();
      current.body.append(current.createElement("canvas"));
      const nestedCanvas = inventory.canCapture();
      frame.remove();
      const removed =
        inventory.canCapture() &&
        inventory.iframeDocuments().size === 0 &&
        !inventory.hasVideo();
      await Promise.resolve();
      const before = changes;
      oldDocument.body.append(oldDocument.createElement("canvas"));
      current.body.append(current.createElement("canvas"));
      await Promise.resolve();
      return {
        initial,
        navigated,
        video,
        nestedCanvas,
        removed,
        detached: changes === before,
      };
    } finally {
      inventory.dispose();
    }
  });
  expect(result).toEqual({
    initial: true,
    navigated: true,
    video: true,
    nestedCanvas: false,
    removed: true,
    detached: true,
  });
});

test("graphics preflight reports a missing adapter before sampling and leaves a blank page", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      value: { requestAdapter: async () => null },
    });
  });
  const result = await browserGraphicsCapabilities(page);
  expect(result.secureContext).toBe(true);
  expect(result.missing).toContain("WebGPU adapter");
  expect(page.url()).toBe("about:blank");
});

for (const mode of ["available", "missing-copy", "device-failure"] as const) {
  test(`graphics preflight handles ${mode} and releases acquired devices`, async ({
    page,
  }) => {
    const actions: string[] = [];
    await page.exposeFunction("recordGraphicsStep", (action: string) => {
      actions.push(action);
    });
    await page.addInitScript((mode) => {
      const record = (action: string) =>
        Reflect.get(window, "recordGraphicsStep")(action);
      Object.defineProperty(navigator, "gpu", {
        value: {
          requestAdapter: async () => {
            await record("adapter");
            return {
              info: {
                vendor: "fixture",
                architecture: "fixture",
                device: "fixture",
                description: "fixture",
              },
              requestDevice: async () => {
                await record("device");
                if (mode === "device-failure")
                  throw new Error("device unavailable");
                return {
                  queue:
                    mode === "missing-copy"
                      ? {}
                      : { copyElementImageToTexture: () => undefined },
                  destroy: () => void record("destroy"),
                };
              },
            };
          },
        },
      });
    }, mode);
    const result = await browserGraphicsCapabilities(page);
    expect(result.missing).toEqual(
      mode === "available"
        ? []
        : mode === "missing-copy"
          ? ["copyElementImageToTexture"]
          : ["WebGPU initialization: Error: device unavailable"],
    );
    expect(result.adapterInfo?.vendor).toBe("fixture");
    await expect
      .poll(() => actions)
      .toEqual(
        mode === "device-failure"
          ? ["adapter", "device"]
          : ["adapter", "device", "destroy"],
      );
    expect(page.url()).toBe("about:blank");
  });
}
