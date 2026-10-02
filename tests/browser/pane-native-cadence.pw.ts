import { expect, test } from "@playwright/test";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

test.use({ trace: "off" });

test("native live panes avoid capture stalls during navigation and overview", async ({
  page,
}, info) => {
  test.setTimeout(45_000);
  const refreshInterval = await page.evaluate(async () => {
    const samples: number[] = [];
    let previous = await new Promise<number>((resolve) =>
      requestAnimationFrame(resolve),
    );
    for (let frame = 0; frame < 60; frame++) {
      const current = await new Promise<number>((resolve) =>
        requestAnimationFrame(resolve),
      );
      samples.push(current - previous);
      previous = current;
    }
    return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
  });
  const maximumMean = Math.min(1000 / 60, refreshInterval) + 0.1;
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?grid&count=100&liveContent&auto&preloadMargin=0`,
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll("iframe").length === 100 &&
      [...document.querySelectorAll("iframe")].every(
        (frame) =>
          frame.contentDocument?.querySelector("h1")?.textContent ===
          "Retained native frame",
      ),
  );
  await page.evaluate(() => {
    for (const [index, frame] of [
      ...document.querySelectorAll("iframe"),
    ].entries()) {
      const document = frame.contentDocument!;
      const graphics = index % 2 === 0;
      const content = document.createElement(graphics ? "canvas" : "div");
      content.style.cssText = "width:100%;height:260px;display:block";
      document.body.append(content);
      let context: CanvasRenderingContext2D | null = null;
      if (content instanceof document.defaultView!.HTMLCanvasElement) {
        content.width = 480;
        content.height = 260;
        context = content.getContext("2d");
      } else {
        window.__nativeMotionFixture.setPresentation(
          `pane-${index + 1}`,
          "dom",
        );
      }
      const draw = (time: number) => {
        if (frame.dataset.consumerState === "live") {
          const color = `hsl(${(time / 20) % 360} 70% 50%)`;
          if (context) {
            context.fillStyle = color;
            context.fillRect(0, 0, 480, 260);
            context.fillStyle = "white";
            context.fillRect(200 + Math.sin(time / 300) * 160, 80, 30, 80);
          } else content.style.backgroundColor = color;
        }
        document.defaultView!.requestAnimationFrame(draw);
      };
      document.defaultView!.requestAnimationFrame(draw);
    }
  });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const prototype = HTMLCanvasElement.prototype as HTMLCanvasElement & {
      captureElementImage(element: Element): unknown;
    };
    const capture = prototype.captureElementImage;
    window.__paneCanvasCopies = 0;
    prototype.captureElementImage = function (element) {
      window.__paneCanvasCopies++;
      return capture.call(this, element);
    };
  });
  const graphics = page
    .locator('[data-onirigiri-pane-id="pane-1"]')
    .frameLocator("iframe")
    .locator("canvas");
  for (const overview of [false, true]) {
    if (overview) {
      await page.evaluate(() =>
        window.__nativeMotionFixture.handle.current!.toggleOverview(),
      );
      await page.waitForTimeout(800);
    }
    const before = await graphics.screenshot();
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    const result = await page.evaluate(async () => {
      const deltas: number[] = [];
      let running = true;
      let previous = 0;
      const tick = (time: number) => {
        if (previous) deltas.push(time - previous);
        previous = time;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const id of [
          "pane-2",
          "pane-12",
          "pane-13",
          "pane-23",
          "pane-22",
          "pane-12",
          "pane-2",
          "pane-1",
        ]) {
          if (!window.__nativeMotionFixture.handle.current!.focusPane(id))
            throw new Error(`Unable to focus ${id}`);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
      running = false;
      const sorted = [...deltas].sort((a, b) => a - b);
      return {
        mean: deltas.reduce((a, b) => a + b, 0) / deltas.length,
        maximum: Math.max(...deltas),
        p99: sorted[Math.floor(sorted.length * 0.99)]!,
        slowRatio: deltas.filter((delta) => delta > 25).length / deltas.length,
        copies: window.__paneCanvasCopies,
      };
    });
    console.log(
      JSON.stringify({
        scenario: overview
          ? "native-content-overview"
          : "native-content-navigation",
        refreshInterval,
        maximumMean,
        ...result,
      }),
    );
    await info.attach(
      `native-content-${overview ? "overview" : "navigation"}`,
      { body: JSON.stringify(result), contentType: "application/json" },
    );
    expect(result.mean).toBeLessThanOrEqual(maximumMean);
    expect(result.p99).toBeLessThanOrEqual(33.4);
    expect(result.maximum).toBeLessThanOrEqual(50);
    expect(result.slowRatio).toBeLessThanOrEqual(0.08);
    expect(result.copies).toBe(0);
    expect((await graphics.screenshot()).equals(before)).toBe(false);
  }
});
