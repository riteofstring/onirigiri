import { expect, test } from "@playwright/test";

import type { NativeMotionFixture } from "./native-content-scene";
import type { TransformMotionFixture } from "./transform-motion-scene";
import { startTwoDimensionalDevServer } from "./two-dimensional-dev-server";
import { startPerformanceCdpTrace } from "../performance/cdp-trace";

let server: Awaited<ReturnType<typeof startTwoDimensionalDevServer>>;

test.beforeAll(async () => {
  server = await startTwoDimensionalDevServer();
});

test.afterAll(async () => {
  await server?.close();
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`native navigation preserves transforms and documents with ${reducedMotion} motion`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(
      `${server.origin}/@fs${server.repositoryRoot}tests/browser/native-content-guard.html?grid&count=20&liveContent&auto&preloadMargin=0`,
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("iframe")].length === 20 &&
        [...document.querySelectorAll("iframe")].every(
          (frame) =>
            frame.contentDocument?.querySelector("h1")?.textContent ===
            "Retained native frame",
        ),
    );
    const result = await page.evaluate(async () => {
      const fixture = Reflect.get(
        window,
        "__nativeMotionFixture",
      ) as NativeMotionFixture;
      const world = document.querySelector<HTMLElement>(
        ".onirigiri-workspace__world",
      )!;
      const cursor = document.querySelector<HTMLElement>(
        ".onirigiri-workspace__grid-cursor",
      )!;
      const retained = [...document.querySelectorAll("iframe")].map(
        (frame) => ({ frame, document: frame.contentDocument }),
      );
      const samples: {
        element: string;
        transitionDurations: EffectTiming["duration"][];
        moving: boolean;
        count: number;
        paused: boolean;
        additive: boolean;
        matrixDifference: number;
      }[] = [];
      const frame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const read = (element: HTMLElement, moving: boolean) => {
        const computed = new DOMMatrixReadOnly(
          getComputedStyle(element).transform,
        );
        const inline = new DOMMatrixReadOnly(element.style.transform);
        const currentAnimations = element.getAnimations();
        const transitions = currentAnimations.filter(
          (animation) => animation instanceof CSSTransition,
        );
        const animations = currentAnimations.filter(
          (animation) => !(animation instanceof CSSTransition),
        );
        samples.push({
          element: element.className,
          transitionDurations: transitions.map(
            (animation) => animation.effect!.getTiming().duration,
          ),
          moving,
          count: animations.length,
          paused: animations.every(
            (animation) => animation.playState === "paused",
          ),
          additive: animations.every((animation) =>
            (animation.effect as KeyframeEffect)
              .getKeyframes()
              .every((keyframe) => keyframe.composite === "add"),
          ),
          matrixDifference: Math.max(
            ...["a", "b", "c", "d", "e", "f"].map((key) =>
              Math.abs(Reflect.get(computed, key) - Reflect.get(inline, key)),
            ),
          ),
        });
      };
      const settle = async () => {
        for (let index = 0; index < 90; index++) {
          await frame();
          const moving =
            world.style.willChange === "transform" ||
            cursor.dataset.moving === "true";
          read(world, world.style.willChange === "transform");
          read(cursor, cursor.dataset.moving === "true");
          if (
            !moving &&
            index > 1 &&
            world.getAnimations().length + cursor.getAnimations().length === 0
          )
            return;
        }
        throw new Error("Motion did not settle");
      };
      await settle();
      for (const mode of ["normal", "overview"]) {
        if (mode === "overview") {
          fixture.handle.current!.toggleOverview();
          await settle();
        }
        for (const id of ["pane-2", "pane-12", "pane-13", "pane-1"]) {
          if (!fixture.handle.current!.focusPane(id))
            throw new Error(`Cannot focus ${id}`);
          await settle();
        }
      }
      return {
        samples,
        retained: retained.every(
          ({ frame, document }) =>
            frame.isConnected && frame.contentDocument === document,
        ),
        remaining: world.getAnimations().length + cursor.getAnimations().length,
      };
    });
    expect(result.retained).toBe(true);
    await testInfo.attach("motion-samples", {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    expect(result.remaining).toBe(0);
    expect(result.samples.length).toBeGreaterThan(20);
    for (const sample of result.samples) {
      expect(sample.count, JSON.stringify(sample)).toBe(sample.moving ? 1 : 0);
      expect(sample.paused).toBe(true);
      expect(sample.additive).toBe(true);
      if (sample.transitionDurations.length === 0) {
        expect(sample.matrixDifference).toBeLessThan(0.0001);
      } else {
        expect(reducedMotion).toBe("reduce");
        for (const duration of sample.transitionDurations) {
          expect(duration).toBe(0.01);
        }
      }
    }
    const moving = result.samples.filter((sample) => sample.moving);
    if (reducedMotion === "reduce") expect(moving).toHaveLength(0);
    else expect(moving.length).toBeGreaterThan(20);
    expect(errors).toEqual([]);
  });
}

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`transform compositor at density ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test("pure motion avoids full layer updates and preserves native pixels", async ({
      page,
      browser,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const url = `${server.origin}/transform-motion.html`;
      await page.route(url, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><body></body>",
        }),
      );
      await page.goto(url);
      await page.addStyleTag({
        url: `/@fs${server.repositoryRoot}src/styles.css`,
      });
      await page.addScriptTag({
        type: "module",
        url: `/@fs${server.repositoryRoot}tests/browser/transform-motion-scene.ts`,
      });
      const fixture = await page.evaluateHandle(
        () =>
          Reflect.get(
            window,
            "__transformMotionFixture",
          ) as TransformMotionFixture,
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const session = await browser.newBrowserCDPSession();
      const trace = await startPerformanceCdpTrace(session, {
        includedCategories: [
          "blink",
          "blink.user_timing",
          "cc",
          "devtools.timeline",
          "toplevel",
        ],
        recordMode: "recordContinuously",
        traceBufferSizeInKb: 16 * 1024,
      });
      try {
        await fixture.evaluate(async ({ step }) => {
          performance.mark("transform-motion-start");
          for (let index = 0; index < 12; index++) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => {
                step();
                resolve();
              }),
            );
          }
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          performance.mark("transform-motion-end");
        });
      } finally {
        const result = await trace.stop();
        await session.detach();
        await testInfo.attach("transform-compositor-trace", {
          body: result.trace,
          contentType: "application/json",
        });
        expect(result.dataLossOccurred).toBe(false);
        const events = (
          JSON.parse(result.trace) as {
            traceEvents: {
              name: string;
              ts: number;
              pid: number;
              tid: number;
            }[];
          }
        ).traceEvents;
        const start = events.find(
          (event) => event.name === "transform-motion-start",
        )!;
        const end = events.find(
          (event) => event.name === "transform-motion-end",
        )!;
        expect(start).toBeDefined();
        expect(end).toBeDefined();
        const measured = events.filter(
          (event) =>
            event.pid === start.pid &&
            event.tid === start.tid &&
            event.ts > start.ts &&
            event.ts < end.ts,
        );
        expect(
          measured.filter((event) => event.name === "UpdateLayoutTree").length,
        ).toBeGreaterThan(8);
        expect(
          measured.filter(
            (event) => event.name === "PaintArtifactCompositor::Update",
          ),
        ).toEqual([]);
      }
      const animated = await page.screenshot();
      await fixture.evaluate(({ unbindWorld, unbindCursor }) => {
        unbindWorld();
        unbindCursor();
      });
      const settled = await page.screenshot();
      await testInfo.attach("motion-native-pixels", {
        body: animated,
        contentType: "image/png",
      });
      await testInfo.attach("released-native-pixels", {
        body: settled,
        contentType: "image/png",
      });
      expect(animated.equals(settled)).toBe(true);
      expect(
        await fixture.evaluate(
          ({ world, cursor }) =>
            world.getAnimations().length + cursor.getAnimations().length,
        ),
      ).toBe(0);
      await fixture.dispose();
      expect(errors).toEqual([]);
    });
  });
}
