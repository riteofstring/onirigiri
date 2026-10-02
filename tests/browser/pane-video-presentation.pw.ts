import { expect, test, type Page } from "@playwright/test";

import { openCanvas } from "./pane-canvas-fixture";
import { chromeLaunchOptions } from "./chrome-launch";

test.use({ trace: "off" });

const repositoryRoot = new URL("../../", import.meta.url).pathname;

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`mixed video presentation at ${deviceScaleFactor}x`, () => {
    test.use({ deviceScaleFactor });

    test("two videos keep live pixels in mixed overview and restore native controls", async ({
      page,
    }, info) => {
      test.setTimeout(45_000);
      const originals = await openMixedVideos(page);
      const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
      const frame = pane.frameLocator("iframe");
      await frame
        .getByRole("textbox", { name: "Video notes" })
        .fill("Preserve playback and input");
      await page.evaluate(() =>
        window.__nativeMotionFixture.handle.current!.toggleOverview(),
      );
      await expect(pane).toHaveAttribute("data-moving", "false");
      await page.waitForTimeout(500);
      const before = await frame.locator("section").screenshot();
      const graphicsBefore = await frame
        .locator("canvas:not([data-onirigiri-video-surface])")
        .screenshot();
      const cadence = await page.evaluate(async () => {
        const videos = [...document.querySelectorAll("iframe")].map((frame) =>
          frame.contentDocument!.querySelector("video")!,
        );
        const before = videos.map(
          (video) => video.getVideoPlaybackQuality().totalVideoFrames,
        );
        const deltas: number[] = [];
        let previous = 0;
        let first = 0;
        await new Promise<void>((resolve) => {
          const tick = (time: number) => {
            if (previous) deltas.push(time - previous);
            previous = time;
            first ||= time;
            if (time - first < 3000) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        return {
          mean: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
          maximum: Math.max(...deltas),
          videos: videos.map((video, index) => ({
            paused: video.paused,
            renderer: video.dataset.onirigiriVideoRenderer ?? "native",
            opacity: getComputedStyle(video).opacity,
            frames:
              video.getVideoPlaybackQuality().totalVideoFrames - before[index]!,
          })),
        };
      });
      await info.attach("mixed-overview-cadence", {
        body: JSON.stringify(cadence),
        contentType: "application/json",
      });
      expect(cadence.mean, JSON.stringify(cadence)).toBeLessThanOrEqual(
        1000 / 60 + 0.1,
      );
      expect(cadence.maximum).toBeLessThanOrEqual(50);
      await expect
        .poll(() =>
          originals.evaluate((items) =>
            items.map(({ video }) => video.dataset.onirigiriVideoRenderer),
          ),
        )
        .toEqual(["canvas", "canvas"]);
      for (const video of cadence.videos) {
        expect(video.paused).toBe(false);
        expect(video.frames).toBeGreaterThanOrEqual(85);
      }
      expect((await frame.locator("section").screenshot()).equals(before)).toBe(
        false,
      );
      expect(
        (
          await frame
            .locator("canvas:not([data-onirigiri-video-surface])")
            .screenshot()
        ).equals(graphicsBefore),
      ).toBe(false);
      expect(
        await originals.evaluate((items) =>
          items.every(
            ({ video, document, graphics, style }) =>
              JSON.stringify(video.getBoundingClientRect()) ===
                JSON.stringify(
                  video.nextElementSibling!.getBoundingClientRect(),
                ) &&
              document.querySelector("canvas") === graphics &&
              video.style.cssText === style,
          ),
        ),
      ).toBe(true);
      await originals.evaluate(async (items) => {
        await Promise.all(
          items.map(
            ({ video }) =>
              new Promise<void>((resolve) => {
                video.pause();
                video.controls = false;
                video.addEventListener("seeked", () => resolve(), {
                  once: true,
                });
                video.currentTime = 1;
              }),
          ),
        );
      });
      for (const fit of ["contain", "cover"]) {
        await page.evaluate(() =>
          window.__nativeMotionFixture.setPresentation("pane-1", "dom"),
        );
        await frame
          .locator("video")
          .evaluate((video, fit) => (video.style.objectFit = fit), fit);
        const native = await frame.locator("section").screenshot();
        await page.evaluate(() =>
          window.__nativeMotionFixture.setPresentation("pane-1", "auto"),
        );
        await expect(frame.locator("video")).toHaveAttribute(
          "data-onirigiri-video-renderer",
          "canvas",
        );
        const presented = await frame.locator("section").screenshot();
        await info.attach(`${fit}-native`, {
          body: native,
          contentType: "image/png",
        });
        await info.attach(`${fit}-presented`, {
          body: presented,
          contentType: "image/png",
        });
        await expectMatchingPixels(page, native, presented);
      }
      await page.evaluate(() =>
        window.__nativeMotionFixture.handle.current!.toggleOverview(),
      );
      await expect(pane).toHaveAttribute("data-moving", "false");
      await expect(frame.locator("[data-onirigiri-video-surface]")).toHaveCount(
        1,
      );
      await originals.evaluate(async (items) => {
        for (const { video } of items) {
          video.controls = true;
          await video.play();
        }
      });
      await expect
        .poll(() =>
          originals.evaluate((items) =>
            items.map(({ video }) => video.dataset.onirigiriVideoRenderer),
          ),
        )
        .toEqual(["canvas", "canvas"]);
      const bounds = (await frame.locator("video").boundingBox())!;
      await page.mouse.move(bounds.x + 40, bounds.y + bounds.height - 40);
      await expect
        .poll(() =>
          originals.evaluate((items) =>
            items.map(({ video }) => video.dataset.onirigiriVideoRenderer),
          ),
        )
        .toEqual([undefined, "canvas"]);
      await expect(
        frame.getByRole("textbox", { name: "Video notes" }),
      ).toHaveValue("Preserve playback and input");
      expect(
        await originals.evaluate((items) =>
          items.every(
            ({ frame, document, video, input, graphics }) =>
              frame.contentDocument === document &&
              document.querySelector("video") === video &&
              document.querySelector("input") === input &&
              document.querySelector("canvas") === graphics &&
              !video.style.anchorName,
          ),
        ),
      ).toBe(true);
      expect(
        await originals.evaluate(
          (items) => getComputedStyle(items[0]!.video).opacity,
        ),
      ).toBe("1");
      await page.waitForTimeout(300);
      await page.mouse.click(bounds.x + 40, bounds.y + bounds.height - 40);
      await expect
        .poll(() =>
          frame
            .locator("video")
            .evaluate((video) => (video as HTMLVideoElement).paused),
        )
        .toBe(true);
      await pane
        .getByRole("button", { name: "Maximize pane", exact: true })
        .click();
      await expect(pane).toHaveAttribute("data-maximized", "true");
      for (const viewport of [
        { width: 1920, height: 1080 },
        { width: 900, height: 1440 },
      ]) {
        await page.setViewportSize(viewport);
        await expect
          .poll(async () => (await frame.locator("video").boundingBox())?.width)
          .toBe(viewport.width - 20);
        await expect(
          frame.locator("[data-onirigiri-video-surface]"),
        ).toHaveCount(0);
        const geometry = await frame.locator("video").boundingBox();
        await page.evaluate(() =>
          window.__nativeMotionFixture.handle.current!.toggleOverview(),
        );
        await expect(frame.locator("video")).toHaveAttribute(
          "data-onirigiri-video-renderer",
          "canvas",
        );
        expect(
          await originals.evaluate(
            (items) => items[0]!.video.videoWidth / items[0]!.video.videoHeight,
          ),
        ).toBe(16 / 9);
        await page.evaluate(() =>
          window.__nativeMotionFixture.handle.current!.toggleOverview(),
        );
        await expect(pane).toHaveAttribute("data-moving", "false");
        expect(await frame.locator("video").boundingBox()).toEqual(geometry);
      }
      await originals.dispose();
    });
  });
}

test("two videos keep live pixels without changing media state or retaining detached presenters", async ({
  page,
}) => {
  const originals = await openMixedVideos(page);
  const events = await originals.evaluateHandle((items) => {
    const events: string[] = [];
    for (const { video } of items)
      for (const type of ["play", "pause", "seeking", "emptied"])
        video.addEventListener(type, () => events.push(type));
    return events;
  });
  const presented = () =>
    originals.evaluate((items) =>
      items.map(({ video }) =>
        video.hasAttribute("data-onirigiri-video-renderer"),
      ),
    );
  const video = page
    .frameLocator('[data-onirigiri-pane-id="pane-1"] iframe')
    .locator("video");
  const toggleOverview = () =>
    page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.toggleOverview(),
    );
  const hover = async (engaged: boolean) => {
    const bounds = (await video.boundingBox())!;
    await page.mouse.move(
      engaged ? bounds.x + bounds.width / 2 : 1,
      engaged ? bounds.y + bounds.height / 2 : 1,
    );
    await expect.poll(presented).toEqual([!engaged, true]);
  };
  for (let cycle = 0; cycle < 4; cycle++) {
    await toggleOverview();
    await expect.poll(presented).toEqual([true, true]);
    await toggleOverview();
    await expect(
      page.locator('[data-onirigiri-pane-id="pane-1"]'),
    ).toHaveAttribute("data-moving", "false");
    await expect.poll(presented).toEqual([true, true]);
    await hover(true);
    await hover(false);
  }
  expect(await events.jsonValue()).toEqual([]);
  await hover(true);
  expect(
    await originals.evaluate((items) =>
      items.every(
        ({ video, style }) => video.style.cssText === style && !video.paused,
      ),
    ),
  ).toBe(true);
  expect(
    await originals.evaluate(
      (items) =>
        items[0]!.document.querySelectorAll("canvas").length === 1 &&
        items[0]!.document.adoptedStyleSheets.length === 0,
    ),
  ).toBe(true);
  await toggleOverview();
  await expect.poll(presented).toEqual([true, true]);
  await originals.evaluate(
    (items) => (items[0]!.video.style.objectFit = "contain"),
  );
  await expect
    .poll(() =>
      originals.evaluate((items) =>
        items[0]!.video.hasAttribute("data-onirigiri-video-renderer"),
      ),
    )
    .toBe(false);
  expect(
    await originals.evaluate((items) => items[0]!.video.style.objectFit),
  ).toBe("contain");
  await toggleOverview();
  await expect(
    page.locator('[data-onirigiri-pane-id="pane-1"]'),
  ).toHaveAttribute("data-moving", "false");
  await hover(false);
  await toggleOverview();
  await expect.poll(presented).toEqual([true, true]);
  await originals.evaluate(
    (items) => (items[0]!.video.addTextTrack("captions").mode = "showing"),
  );
  await expect
    .poll(() =>
      originals.evaluate(
        (items) =>
          items[0]!.document.querySelectorAll("[data-onirigiri-video-surface]")
            .length,
      ),
    )
    .toBe(0);
  await originals.evaluate((items) => items[1]!.video.remove());
  await expect
    .poll(() =>
      originals.evaluate(
        (items) =>
          items[1]!.document.querySelectorAll("[data-onirigiri-video-surface]")
            .length,
      ),
    )
    .toBe(0);
  expect(
    await originals.evaluate((items) =>
      items.every(({ document }) => document.adoptedStyleSheets.length === 0),
    ),
  ).toBe(true);
  await originals.dispose();
  await events.dispose();
});

async function expectMatchingPixels(
  page: Page,
  native: Buffer,
  presented: Buffer,
): Promise<void> {
  const difference = await page.evaluate(
    async (images) => {
      const decode = async (source: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${source}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [a, b] = await Promise.all(images.map(decode));
      let samples = 0;
      let changed = 0;
      for (let y = 2; y < a!.height - 2; y++) {
        for (let x = 2; x < a!.width - 2; x++) {
          const offset = (y * a!.width + x) * 4;
          const flat = [-2, 0, 2].every((dy) =>
            [-2, 0, 2].every((dx) =>
              [0, 1, 2].every(
                (channel) =>
                  Math.abs(
                    a!.data[offset + channel]! -
                      a!.data[((y + dy) * a!.width + x + dx) * 4 + channel]!,
                  ) <= 8,
              ),
            ),
          );
          if (!flat) continue;
          samples++;
          if (
            [0, 1, 2].some(
              (channel) =>
                Math.abs(
                  a!.data[offset + channel]! - b!.data[offset + channel]!,
                ) > 8,
            )
          )
            changed++;
        }
      }
      return {
        dimensions: [b!.width, b!.height],
        expected: [a!.width, a!.height],
        coverage: samples / (a!.width * a!.height),
        changed: changed / samples,
      };
    },
    [native.toString("base64"), presented.toString("base64")],
  );
  expect(difference.dimensions).toEqual(difference.expected);
  expect(difference.coverage).toBeGreaterThan(0.5);
  expect(difference.changed).toBeLessThan(0.005);
}

async function openMixedVideos(page: Page) {
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?count=2&liveContent&auto&preloadMargin=0`,
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("iframe")].length === 2 &&
      [...document.querySelectorAll("iframe")].every((frame) =>
        frame.contentDocument?.querySelector("h1"),
      ),
  );
  return await page.evaluateHandle(async (root) => {
    return await Promise.all(
      [...document.querySelectorAll("iframe")].map(async (frame) => {
        const document = frame.contentDocument!;
        document.body.style.cssText = "margin:0;background:#345";
        document.body.innerHTML = `<input aria-label="Video notes" value="Keep original state"><section style="position:relative;width:100%;height:290px;overflow:hidden"><video style="display:block;box-sizing:border-box;width:100%;height:270px;padding:7px;border:3px solid orange;border-radius:18px;object-fit:cover;object-position:25% 50%"></video><b style="position:absolute;right:12px;top:25px;background:#f0f">Overlapping content</b></section><canvas width="480" height="100" style="width:100%;height:100px;display:block"></canvas>`;
        const video = document.querySelector("video")!;
        video.src = `/@fs${root}bench/public/video-30fps.webm`;
        video.loop = video.muted = video.controls = true;
        const graphics = document.querySelector("canvas")!;
        const context = graphics.getContext("2d")!;
        const draw = (time: number) => {
          context.fillStyle = `hsl(${(time / 10) % 360} 80% 50%)`;
          context.fillRect(0, 0, 480, 100);
          document.defaultView!.requestAnimationFrame(draw);
        };
        document.defaultView!.requestAnimationFrame(draw);
        await video.play();
        return {
          frame,
          document,
          video,
          graphics,
          input: document.querySelector("input")!,
          style: video.style.cssText,
        };
      }),
    );
  }, repositoryRoot);
}

for (const deviceScaleFactor of [1, 2]) {
  test(`two videos keep live pixels and 60Hz with native input at ${deviceScaleFactor}x`, async ({
    playwright,
    baseURL,
  }, info) => {
    const browser = await playwright.chromium.launch({
      ...chromeLaunchOptions,
      headless: true,
    });
    const page = await browser.newPage({
      baseURL,
      deviceScaleFactor,
      viewport: { width: 1280, height: 900 },
    });
    try {
      await openCanvas(page);
      await page.evaluate((repositoryRoot) => {
        const fixture = window.__paneCanvasFixture;
        const content = document.querySelector<HTMLElement>("#content")!;
        content.replaceChildren();
        const input = document.createElement("input");
        input.setAttribute("aria-label", "Video notes");
        content.append(input);
        for (let index = 0; index < 2; index++) {
          const video = document.createElement("video");
          video.src = `/@fs${repositoryRoot}bench/public/video-30fps.webm`;
          video.autoplay = video.loop = video.muted = video.controls = true;
          video.style.cssText = "display:block;width:480px;height:270px";
          content.append(video);
        }
        fixture.pane.style.cssText =
          "position:absolute;left:0;top:0;width:480px;height:600px";
        fixture.motionRenderer = "canvas";
        fixture.live = true;
        fixture.surface.requestPaint();
      }, repositoryRoot);
      await expect
        .poll(() =>
          page
            .locator("video")
            .evaluateAll((videos) =>
              videos.every(
                (video) =>
                  video instanceof HTMLVideoElement &&
                  !video.paused &&
                  video.currentTime > 0.5,
              ),
            ),
        )
        .toBe(true);
      await page
        .getByRole("textbox", { name: "Video notes" })
        .fill("Keep both streams playing");
      await page.waitForTimeout(1000);
      const sample = await page.evaluate(async () => {
        const videos = [...document.querySelectorAll("video")];
        const frames = videos.map(
          (video) => video.getVideoPlaybackQuality().totalVideoFrames,
        );
        const deltas: number[] = [];
        let first: number | undefined;
        let previous: number | undefined;
        await new Promise<void>((resolve) => {
          function frame(time: number) {
            first ??= time;
            if (previous !== undefined) deltas.push(time - previous);
            previous = time;
            if (time - first < 3000) requestAnimationFrame(frame);
            else resolve();
          }
          requestAnimationFrame(frame);
        });
        return {
          deltas,
          mean: deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length,
          videos: videos.map((video, index) => ({
            paused: video.paused,
            frames:
              video.getVideoPlaybackQuality().totalVideoFrames - frames[index]!,
          })),
        };
      });
      await info.attach("simultaneous-video-cadence", {
        body: JSON.stringify(sample),
        contentType: "application/json",
      });
      expect(sample.mean).toBeLessThanOrEqual(1000 / 60 + 0.1);
      for (const video of sample.videos) {
        expect(video.paused).toBe(false);
        expect(video.frames).toBeGreaterThanOrEqual(85);
      }
      const videos = await page.locator("video").all();
      const before = await Promise.all(
        videos.map((video) => video.screenshot()),
      );
      await page.waitForTimeout(500);
      for (const [index, video] of videos.entries())
        expect((await video.screenshot()).equals(before[index]!)).toBe(false);
      const video = videos[0]!;
      const bounds = (await video.boundingBox())!;
      await page.mouse.move(bounds.x + 30, bounds.y + bounds.height - 28);
      await page.waitForTimeout(300);
      await page.mouse.click(bounds.x + 30, bounds.y + bounds.height - 28);
      await expect
        .poll(() =>
          video.evaluate(
            (element) => element instanceof HTMLVideoElement && element.paused,
          ),
        )
        .toBe(true);
      await expect(
        page.getByRole("textbox", { name: "Video notes" }),
      ).toHaveValue("Keep both streams playing");
      expect(
        await page.evaluate(() => window.__paneCanvasFixture.error),
      ).toBeNull();
    } finally {
      await browser.close();
    }
  });
}
