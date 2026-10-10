import { expect, test } from "@playwright/test";
import { build } from "vite";

let source: string;
let animationSource: string;

async function bundleSource(path: string, name: string): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: new URL(path, import.meta.url).pathname,
        name,
        formats: ["iife"],
      },
    },
  });
  const bundle = Array.isArray(result) ? result[0]! : result;
  if (!("output" in bundle)) throw new Error("Expected pane content bundle");
  const chunk = bundle.output.find((item) => item.type === "chunk");
  if (!chunk) throw new Error("Missing pane content bundle");
  return chunk.code;
}

test.beforeAll(async () => {
  [source, animationSource] = await Promise.all([
    bundleSource("../../src/pictures/pane-picture-content.ts", "paneContent"),
    bundleSource(
      "../../src/panes/pane-content-animations.ts",
      "paneAnimations",
    ),
  ]);
});

for (const initiallyFrozen of [false, true]) {
  test(`first freeze pauses existing animations without resuming authored pauses (initiallyFrozen=${initiallyFrozen})`, async ({
    page,
  }) => {
    await page.setContent(`<!doctype html><style>
      @keyframes motion { to { transform: translateX(12px); } }
      .animated { width: 8px; height: 8px; animation: motion 10s linear infinite; }
    </style><main><div class="animated"></div><div class="animated" style="animation-play-state:paused"></div></main>`);
    await page.addScriptTag({ content: animationSource });
    const result = await page.evaluate(async (initiallyFrozen) => {
      const content = document.querySelector("main")!;
      const [running, authoredPause] = content.getAnimations({ subtree: true });
      await Promise.all([running!.ready, authoredPause!.ready]);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      let subtreeScans = 0;
      const getAnimations = content.getAnimations.bind(content);
      content.getAnimations = (options) => {
        subtreeScans++;
        return getAnimations(options);
      };
      const { syncContentAnimations } = Reflect.get(window, "paneAnimations");
      const before = [running!.playState, authoredPause!.playState];
      syncContentAnimations(content, initiallyFrozen);
      syncContentAnimations(content, true);
      const frozen = [running!.playbackRate, authoredPause!.playbackRate];
      const stoppedAt = running!.currentTime;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const stayedStill = running!.currentTime === stoppedAt;
      syncContentAnimations(content, false);
      const thawed = [running!.playState, authoredPause!.playState];
      syncContentAnimations(content, true);
      const refrozen = [running!.playbackRate, authoredPause!.playbackRate];
      syncContentAnimations(content, false);
      const pausedElement = content.children[1] as HTMLElement;
      pausedElement.style.animationPlayState = "running";
      pausedElement.getAnimations();
      syncContentAnimations(content, true);
      const afterAuthoredResume = [
        running!.playbackRate,
        authoredPause!.playbackRate,
      ];
      return {
        before,
        frozen,
        thawed,
        refrozen,
        afterAuthoredResume,
        subtreeScans,
        stayedStill,
      };
    }, initiallyFrozen);
    expect(result).toEqual({
      before: ["running", "paused"],
      frozen: [0, 1],
      thawed: ["running", "paused"],
      refrozen: [0, 1],
      afterAuthoredResume: [0, 0],
      subtreeScans: 1,
      stayedStill: true,
    });
  });
}

test("tracks animations that start after live initialization and while frozen", async ({
  page,
}) => {
  await page.setContent(`<!doctype html><style>
    @keyframes motion { to { transform: translateX(12px); } }
    .animated { width: 8px; height: 8px; animation: motion 10s linear infinite; }
  </style><main></main>`);
  await page.addScriptTag({ content: animationSource });
  const result = await page.evaluate(async () => {
    const content = document.querySelector("main")!;
    const { syncContentAnimations } = Reflect.get(window, "paneAnimations");
    syncContentAnimations(content, false);
    const addAnimation = async () => {
      const element = document.createElement("div");
      element.className = "animated";
      const started = new Promise<void>((resolve) =>
        content.addEventListener("animationstart", () => resolve(), {
          once: true,
        }),
      );
      content.append(element);
      await started;
      return element.getAnimations()[0]!;
    };
    const first = await addAnimation();
    syncContentAnimations(content, true);
    const second = await addAnimation();
    const frozen = [first.playbackRate, second.playbackRate];
    syncContentAnimations(content, false);
    return { frozen, thawed: [first.playState, second.playState] };
  });
  expect(result).toEqual({
    frozen: [0, 0],
    thawed: ["running", "running"],
  });
});

test("live animation tracking does not retain removed content", async ({
  page,
  context,
}) => {
  await page.setContent(`<!doctype html><style>
    @keyframes motion { to { transform: translateX(12px); } }
    .animated { width: 8px; height: 8px; animation: motion 10s linear infinite; }
  </style><main><div class="animated"></div></main>`);
  await page.addScriptTag({ content: animationSource });
  await page.evaluate(() => {
    const content = document.querySelector("main")!;
    const element = content.firstElementChild!;
    Reflect.get(window, "paneAnimations").syncContentAnimations(content, false);
    Reflect.set(window, "removedAnimatedContent", new WeakRef(element));
    element.remove();
  });
  const session = await context.newCDPSession(page);
  try {
    await session.send("HeapProfiler.collectGarbage");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await session.send("HeapProfiler.collectGarbage");
    expect(
      await page.evaluate(
        () =>
          Reflect.get(window, "removedAnimatedContent").deref() === undefined,
      ),
    ).toBe(true);
  } finally {
    await session.detach();
  }
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

test("freezing preserves subsequent CSS pauses and consumer playback rates", async ({
  page,
}) => {
  await page.setContent(`<!doctype html><style>
    @keyframes motion { to { transform: translateX(12px); } }
    .animated { width: 8px; height: 8px; animation: motion 10s linear infinite; }
  </style><main><div class="animated"></div><div class="animated"></div></main>`);
  await page.addScriptTag({ content: animationSource });
  const result = await page.evaluate(() => {
    const content = document.querySelector("main")!;
    const element = content.firstElementChild as HTMLElement;
    const [first, second] = content.getAnimations({ subtree: true });
    const { syncContentAnimations } = Reflect.get(window, "paneAnimations");
    second!.playbackRate = 2;
    syncContentAnimations(content, true);
    element.style.animationPlayState = "paused";
    element.getAnimations();
    syncContentAnimations(content, false);
    const authoredPause = first!.playState;
    const restoredRate = second!.playbackRate;
    element.style.animationPlayState = "running";
    element.getAnimations();
    const authoredResume = first!.playState;
    syncContentAnimations(content, true);
    second!.playbackRate = 3;
    syncContentAnimations(content, false);
    return {
      authoredPause,
      authoredResume,
      restoredRate,
      replacedRate: second!.playbackRate,
    };
  });
  expect(result).toEqual({
    authoredPause: "paused",
    authoredResume: "running",
    restoredRate: 2,
    replacedRate: 3,
  });
});
