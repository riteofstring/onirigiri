import { expect, test } from "@playwright/test";
import { nativeContentPixels, openCanvas } from "./pane-canvas-fixture";
import { chromeLaunchOptions } from "./chrome-launch";

test.use({
  launchOptions: chromeLaunchOptions,
});

test.describe("nested canvas pixels in headless Chrome", () => {
  test("preserves text, borders and iframe geometry between live and frozen presentation", async ({
    playwright,
    baseURL,
  }, testInfo) => {
    const browser = await playwright.chromium.launch({
      ...chromeLaunchOptions,
      headless: true,
    });
    const page = await browser.newPage({
      baseURL,
      deviceScaleFactor: 2,
      viewport: { width: 1280, height: 900 },
    });
    try {
      await openCanvas(page);
      await page.evaluate(() => {
        const fixture = window.__paneCanvasFixture;
        const content = document.querySelector<HTMLElement>("#content")!;
        content.className = "onirigiri-pane__live-content";
        content.style.cssText =
          "font:13px sans-serif;background:white;color:black";
        const markup =
          '<header style="display:flex;justify-content:space-between;border-bottom:1px solid;padding:13px"><label>Field notes</label><span>152 characters</span></header><div style="padding:13px"><span style="border:1px solid;padding:3px">Navigation</span><p>A spatial interface should keep the same layout when motion settles.</p><textarea style="display:block;width:90%;height:48px;font:inherit">Keep this edit</textarea></div>';
        for (const child of [...content.children])
          if (child !== fixture.iframe) child.remove();
        const direct = document.createElement("section");
        direct.innerHTML = markup;
        content.prepend(direct);
        fixture.iframe.style.height = "300px";
        fixture.document.body.style.cssText =
          "margin:0;font:13px sans-serif;background:white;color:black";
        fixture.document.body.innerHTML = markup;
        fixture.pane.style.height = "600px";
        fixture.pane.style.transform = "none";
        fixture.live = true;
        fixture.surface.requestPaint();
      });
      await expect(page.locator("#content")).toHaveAttribute(
        "data-onirigiri-live",
        "true",
      );
      const geometry = () =>
        page.evaluate(() => {
          const fixture = window.__paneCanvasFixture;
          const content = document.querySelector<HTMLElement>("#content")!;
          if (fixture.iframe.contentDocument !== fixture.document)
            throw new Error("The retained iframe document changed");
          return [content, fixture.document.body].map((root) => {
            const origin = root.getBoundingClientRect();
            return [root, ...root.querySelectorAll("*")].map((node) => {
              const rect = node.getBoundingClientRect();
              return [
                rect.x - origin.x,
                rect.y - origin.y,
                rect.width,
                rect.height,
              ];
            });
          });
        });
      for (const width of [400, 401, 480]) {
        await page.evaluate((width) => {
          window.__paneCanvasFixture.pane.style.width = `${width}px`;
        }, width);
        const native = await geometry();
        const version = await page.evaluate(() => {
          const fixture = window.__paneCanvasFixture;
          fixture.live = false;
          fixture.surface.requestPaint();
          return fixture.surface.frameVersion;
        });
        await expect
          .poll(() =>
            page.evaluate(
              () => window.__paneCanvasFixture.surface.frameVersion,
            ),
          )
          .toBeGreaterThan(version);
        expect(await geometry()).toEqual(native);
        const nativePixels = await nativeContentPixels(page);
        const difference = await page.evaluate(async (encoded) => {
          const fixture = window.__paneCanvasFixture;
          const pixels = async (url: string) => {
            const image = await createImageBitmap(
              await (await fetch(url)).blob(),
            );
            const canvas = new OffscreenCanvas(image.width, image.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            image.close();
            return context.getImageData(0, 0, canvas.width, canvas.height);
          };
          const native = await pixels(`data:image/png;base64,${encoded}`);
          const motionPng = fixture.canvas.toDataURL();
          const motion = await pixels(motionPng);
          let maximumError = 0;
          let totalError = 0;
          for (let index = 0; index < native.data.length; index++) {
            const error = Math.abs(native.data[index]! - motion.data[index]!);
            maximumError = Math.max(maximumError, error);
            totalError += error;
          }
          return {
            dimensions: [motion.width, motion.height],
            expectedDimensions: [native.width, native.height],
            maximumError,
            meanError: totalError / native.data.length,
            motionPng,
          };
        }, nativePixels.toString("base64"));
        await testInfo.attach(`native-${width}px.png`, {
          body: nativePixels,
          contentType: "image/png",
        });
        await testInfo.attach(`motion-${width}px.png`, {
          body: Buffer.from(difference.motionPng.split(",")[1]!, "base64"),
          contentType: "image/png",
        });
        expect(difference.dimensions).toEqual(difference.expectedDimensions);
        expect(difference.maximumError).toBeLessThanOrEqual(8);
        expect(difference.meanError).toBeLessThan(0.001);
        await page.evaluate(() => {
          const fixture = window.__paneCanvasFixture;
          fixture.live = true;
          fixture.surface.requestPaint();
        });
        await expect(page.locator("#content")).toHaveAttribute(
          "data-onirigiri-live",
          "true",
        );
        expect(await geometry()).toEqual(native);
        expect(await page.locator("#content textarea").inputValue()).toBe(
          "Keep this edit",
        );
        await expect(
          page.locator("#content iframe").contentFrame().locator("textarea"),
        ).toHaveValue("Keep this edit");
      }
      expect(
        await page.evaluate(() => window.__paneCanvasFixture.error),
      ).toBeNull();
      await page.evaluate(() => window.__paneCanvasFixture.surface.dispose());
      expect(await page.locator("#canvas > #content").count()).toBe(1);
    } finally {
      await browser.close();
    }
  });

  for (const framed of [false, true]) {
    test(`matches native crop through motion and resizing ${framed ? "inside an iframe" : "in the pane"}`, async ({
      playwright,
      baseURL,
    }) => {
      const browser = await playwright.chromium.launch({
        ...chromeLaunchOptions,
        headless: true,
      });
      const page = await browser.newPage({
        baseURL,
        deviceScaleFactor: 2,
        viewport: { width: 1280, height: 900 },
      });
      try {
        await openCanvas(page);
        const identity = await page.evaluate((framed) => {
          const fixture = window.__paneCanvasFixture;
          const content = document.querySelector<HTMLElement>("#content")!;
          content.style.cssText =
            "width:100%;height:100%;position:relative;overflow:hidden";
          const host = framed ? fixture.document.body : content;
          if (framed) {
            fixture.document.documentElement.style.height = "100%";
            host.style.cssText =
              "margin:0;width:100%;height:100%;position:relative;overflow:hidden";
            for (const child of [...content.children]) {
              if (child !== fixture.iframe) child.remove();
            }
            fixture.iframe.style.height = "100%";
          }
          host.innerHTML =
            '<canvas width="960" height="540" style="position:absolute;width:960px;height:540px;left:50%;top:50%;transform-origin:center"></canvas><div style="position:absolute;right:12px;bottom:12px;width:32px;height:24px;background:#ff00ff"></div>';
          const canvas = host.querySelector("canvas")!;
          const context = canvas.getContext("2d")!;
          context.fillStyle = "#123456";
          context.fillRect(0, 0, 960, 540);
          for (let y = 30; y < 540; y += 60) {
            for (let x = 30; x < 960; x += 60) {
              context.fillStyle = x % 120 === 30 ? "#6af0ac" : "#f0b34c";
              context.beginPath();
              context.arc(x, y, 13, 0, Math.PI * 2);
              context.fill();
            }
          }
          const fit = () => {
            const scale = Math.max(
              host.clientWidth / 960,
              host.clientHeight / 540,
            );
            canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
          };
          new ResizeObserver(fit).observe(host);
          fit();
          canvas.dataset.identity = "original";
          fixture.pane.style.transform = "none";
          fixture.live = true;
          fixture.surface.requestPaint();
          return canvas.toDataURL();
        }, framed);
        for (const [width, height] of [
          [400, 600],
          [700, 260],
          [320, 500],
        ]) {
          await page.evaluate(
            ({ width, height }) => {
              const fixture = window.__paneCanvasFixture;
              fixture.surface.setResizing(true);
              fixture.pane.style.width = `${width}px`;
              fixture.pane.style.height = `${height}px`;
              fixture.live = true;
              fixture.surface.setResizing(false);
            },
            { width, height },
          );
          await expect(page.locator("#content")).toHaveAttribute(
            "data-onirigiri-live",
            "true",
          );
          const version = await page.evaluate(() => {
            const fixture = window.__paneCanvasFixture;
            fixture.live = false;
            const version = fixture.surface.frameVersion;
            fixture.surface.requestPaint();
            return version;
          });
          await expect
            .poll(() =>
              page.evaluate(
                () => window.__paneCanvasFixture.surface.frameVersion,
              ),
            )
            .toBeGreaterThan(version);
          const native = await nativeContentPixels(page);
          const result = await page.evaluate(
            async ({ native, framed }) => {
              const fixture = window.__paneCanvasFixture;
              async function pixels(blob: Blob) {
                const bitmap = await createImageBitmap(blob);
                const reader = new OffscreenCanvas(bitmap.width, bitmap.height);
                const context = reader.getContext("2d")!;
                context.drawImage(bitmap, 0, 0);
                bitmap.close();
                return context.getImageData(0, 0, reader.width, reader.height);
              }
              const expected = await pixels(
                await (await fetch(`data:image/png;base64,${native}`)).blob(),
              );
              const images = [
                await new Promise<Blob>((resolve) =>
                  fixture.canvas.toBlob((blob) => resolve(blob!)),
                ),
              ];
              for (const stage of [false, true]) {
                if (stage)
                  fixture.pane.style.transform = "translate(-900px,-700px)";
                const captured = await fixture.surface.capture({
                  stage,
                  signal: AbortSignal.timeout(5000),
                  maxRasterBytes: 16 * 1024 * 1024,
                  maxEncodedBytes: 8 * 1024 * 1024,
                });
                images.push(captured.image);
              }
              fixture.pane.style.transform = "none";
              const differences = [];
              for (const image of images) {
                const actual = await pixels(image);
                let error = 0;
                let mismatches = 0;
                for (
                  let offset = 0;
                  offset < expected.data.length;
                  offset += 4
                ) {
                  let difference = 0;
                  for (let channel = 0; channel < 4; channel++)
                    difference += Math.abs(
                      actual.data[offset + channel]! -
                        expected.data[offset + channel]!,
                    );
                  error += difference;
                  if (difference > 20) mismatches++;
                }
                differences.push({
                  dimensions: [actual.width, actual.height],
                  meanError: error / expected.data.length,
                  mismatches: mismatches / (expected.data.length / 4),
                });
              }
              const owner = framed
                ? fixture.document
                : document.querySelector<HTMLElement>("#content")!;
              const canvas = owner.querySelector<HTMLCanvasElement>(
                'canvas[data-identity="original"]',
              )!;
              return {
                differences,
                bitmap: canvas.toDataURL(),
                source: [canvas.width, canvas.height],
                content: [
                  document.querySelector<HTMLElement>("#content")!.offsetWidth,
                  document.querySelector<HTMLElement>("#content")!.offsetHeight,
                ],
                sameDocument:
                  fixture.iframe.contentDocument === fixture.document,
                error: fixture.error,
              };
            },
            { native: native.toString("base64"), framed },
          );
          expect(result.bitmap).toBe(identity);
          expect(result.source).toEqual([960, 540]);
          expect(result.content).toEqual([width, height]);
          if (framed) expect(result.sameDocument).toBe(true);
          expect(result.error).toBeNull();
          for (const difference of result.differences) {
            expect(difference.dimensions).toEqual([width! * 2, height! * 2]);
            expect(difference.meanError).toBeLessThan(0.5);
            expect(difference.mismatches).toBeLessThan(0.005);
          }
        }
      } finally {
        await browser.close();
      }
    });
  }
});
