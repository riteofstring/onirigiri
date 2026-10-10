import { expect, test } from "@playwright/test";
import { build } from "vite";

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
          "../../src/pictures/pane-picture-content.ts",
          import.meta.url,
        ).pathname,
        name: "paneContent",
        formats: ["iife"],
      },
    },
  });
  const bundle = Array.isArray(result) ? result[0]! : result;
  if (!("output" in bundle)) throw new Error("Expected pane content bundle");
  const chunk = bundle.output.find((item) => item.type === "chunk");
  if (!chunk) throw new Error("Missing pane content bundle");
  source = chunk.code;
});

for (const tracking of ["initial", "event", "disposed"] as const) {
  test(`removed ${tracking} scrollers are collectable without another host move`, async ({
    page,
    context,
  }) => {
    await page.setContent("<!doctype html><canvas></canvas><main></main>");
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      const api = Reflect.get(window, "paneContent");
      Reflect.set(
        window,
        "createScrollOwner",
        () =>
          new api.PanePictureContent(
            document.querySelector("canvas")!,
            document.querySelector("main")!,
            {
              canPresent: () => true,
              changed: () => undefined,
              interactive: () => true,
              presented: () => undefined,
            },
          ),
      );
    });
    await page.evaluate(async (tracking) => {
      const content = document.querySelector("main")!;
      const subtree = document.createElement("section");
      const scroller = document.createElement("div");
      scroller.style.cssText = "overflow:auto;width:100px;height:100px";
      scroller.innerHTML =
        '<div style="height:2000px">Scrollable content</div>';
      subtree.append(scroller);
      content.append(subtree);
      const create = Reflect.get(window, "createScrollOwner");
      let owner = tracking === "initial" ? null : create();
      await new Promise<void>((resolve) => {
        scroller.addEventListener("scroll", () => resolve(), { once: true });
        scroller.scrollTop = 176;
      });
      if (tracking === "initial") {
        owner = create();
        owner.preserveScroll(() => undefined);
      }
      Reflect.set(window, "scrollOwner", owner);
      Reflect.set(window, "removedScroller", new WeakRef(scroller));
      if (tracking === "disposed") owner.dispose();
      subtree.remove();
    }, tracking);
    const session = await context.newCDPSession(page);
    try {
      await session.send("HeapProfiler.collectGarbage");
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      await session.send("HeapProfiler.collectGarbage");
      expect(
        await page.evaluate(
          () => Reflect.get(window, "removedScroller").deref() === undefined,
        ),
      ).toBe(true);
    } finally {
      await page.evaluate(() => Reflect.get(window, "scrollOwner").dispose());
      await session.detach();
    }
  });
}
