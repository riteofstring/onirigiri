import { expect, test } from "@playwright/test";
import { openCanvas } from "./pane-canvas-fixture";
import { chromeLaunchOptions } from "./chrome-launch";

test.use({ launchOptions: chromeLaunchOptions });

test("cross-origin iframe capture fails explicitly and restores staging", async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(async () => {
    const iframe = window.__paneCanvasFixture.iframe;
    const url = new URL(iframe.src);
    url.hostname = "localhost";
    await new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
      iframe.src = url.href;
    });
  });
  const message = await page.evaluate(async () => {
    try {
      await window.__paneCanvasFixture.surface.capture({
        signal: AbortSignal.timeout(5000),
        stage: true,
        maxRasterBytes: 128 * 1024 * 1024,
        maxEncodedBytes: 32 * 1024 * 1024,
      });
      return "accepted";
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(message).toContain("cross-origin iframe");
  await expect(page.locator(":popover-open")).toHaveCount(0);
});

test("hidden live surfaces skip final captures and redraw on reentry", async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.pane.style.transform = "none";
    const content = document.querySelector<HTMLElement>("#content")!;
    content.innerHTML = "Live content";
    fixture.live = true;
    fixture.motionRenderer = "canvas";
    fixture.surface.requestPaint();
  });
  await expect
    .poll(() => page.evaluate(() => window.__paneCanvasFixture.drawn))
    .toBe(true);
  const before = await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.live = false;
    fixture.visible = false;
    fixture.pane.style.transform = "translateX(-2000px)";
    document.querySelector<HTMLElement>("#content")!.textContent =
      "Updated while hidden";
    const version = fixture.surface.frameVersion;
    fixture.surface.requestPaint();
    return version;
  });
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => window.__paneCanvasFixture.surface.frameVersion),
  ).toBe(before);
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.live = true;
    fixture.visible = true;
    fixture.pane.style.transform = "none";
    fixture.surface.requestPaint();
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__paneCanvasFixture.surface.frameVersion),
    )
    .toBeGreaterThan(before);
  await expect(page.locator("#content")).toHaveText("Updated while hidden");
});

test("native content recovers after a GPU device loss during canvas presentation", async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.pane.style.transform = "none";
    document.querySelector("#gpu")!.remove();
    fixture.live = true;
    fixture.motionRenderer = "canvas";
    fixture.surface.requestPaint();
  });
  await expect
    .poll(() => page.evaluate(() => window.__paneCanvasFixture.drawn))
    .toBe(true);
  const original = await page.locator("iframe").elementHandle();
  await page.evaluate(() => window.__paneCanvasFixture.device!.destroy());
  await expect
    .poll(() => page.evaluate(() => window.__paneCanvasFixture.error))
    .toContain("device lost");
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.motionRenderer = "dom";
    fixture.surface.requestPaint();
  });
  await expect(page.locator("#canvas")).toHaveAttribute(
    "data-onirigiri-native-active",
    "true",
  );
  expect(
    await page
      .locator("iframe")
      .evaluate((iframe, original) => iframe === original, original),
  ).toBe(true);
  await expect(page.frameLocator("iframe").getByRole("textbox")).toHaveValue(
    "Keep this edit",
  );
});
