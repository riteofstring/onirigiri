import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { PaneDefaultsFixture } from "./pane-defaults";

declare global {
  interface Window {
    __paneDefaultsFixture: PaneDefaultsFixture;
  }
}

const repositoryRoot = new URL("../../", import.meta.url).pathname;

for (const port of [4173, 4174]) {
  test(`playground texture memory changes preserve content and survive reload on ${port}`, async ({
    page,
  }) => {
    await page.goto(`http://127.0.0.1:${port}/?count=5&content=notes`);
    const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
    await expect(pane.locator('[data-onirigiri-live="true"]')).toHaveCount(1);
    await expect(
      pane.locator('[data-onirigiri-slot="pane-live-content"]'),
    ).not.toHaveAttribute("inert");
    const note = pane.locator("textarea").first();
    await note.fill("Keep this note while changing the cache");
    await expect(note).toHaveValue("Keep this note while changing the cache");
    const menu = page.locator(".playground-content-menu");
    await menu.locator("summary").click();
    const memory = menu.getByRole("spinbutton", {
      name: "Texture memory (MiB)",
    });
    await expect(memory).toHaveValue("256");
    await memory.fill("512");
    await memory.press("Enter");
    await expect(page).toHaveURL(/textureMemory=512/);
    await expect(note).toHaveValue("Keep this note while changing the cache");
    await memory.fill("");
    await memory.press("Tab");
    await expect(memory).toHaveValue("512");
    await page.reload();
    await menu.locator("summary").click();
    await expect(memory).toHaveValue("512");
    await memory.fill("64");
    await memory.press("Enter");
    await expect(page).toHaveURL(/textureMemory=64/);
  });
}

test("theme sizes preserve minimum button targets and allow larger controls", async ({
  page,
}) => {
  await openFixture(page);
  const workspace = page.locator('[data-onirigiri-slot="workspace"]');
  for (const [minimum, requested] of [
    [24, 8],
    [40, 8],
    [40, 64],
  ]) {
    await workspace.evaluate(
      (element, values) => {
        element.style.setProperty(
          "--onirigiri-minimum-target-size",
          `${values.minimum}px`,
        );
        element.style.setProperty(
          "--onirigiri-control-size",
          `${values.requested}px`,
        );
        element.style.setProperty(
          "--onirigiri-pane-action-size",
          `${values.requested}px`,
        );
      },
      { minimum: minimum!, requested: requested! },
    );
    for (const slot of ["control", "pane-action"]) {
      const button = workspace
        .locator(`[data-onirigiri-slot="${slot}"]`)
        .first();
      await expect(button).toBeVisible();
      const size = `${Math.max(minimum!, requested!)}px`;
      await expect(button).toHaveCSS("width", size);
      await expect(button).toHaveCSS("height", size);
    }
  }
});

test("the 1D playground stays on its row under vertical keyboard and wheel navigation", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/?count=10&content=notes");
  const workspace = page.locator(".onirigiri-workspace");
  const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
  await expect(
    pane.locator('[data-onirigiri-slot="pane-content"]'),
  ).toHaveAttribute("data-onirigiri-content-ready", "true");
  await workspace.focus();
  const original = await pane.boundingBox();
  for (const key of ["Alt+ArrowUp", "Alt+ArrowDown"]) {
    await page.keyboard.press(key);
    await expect(pane).toHaveAttribute("data-focused", "true");
  }
  await page.locator('[data-onirigiri-slot="stage"]').dispatchEvent("wheel", {
    deltaX: 0,
    deltaY: 63.5,
    deltaMode: 0,
    bubbles: true,
    cancelable: true,
  });
  await expect(pane).toHaveAttribute("data-focused", "true");
  expect((await pane.boundingBox())!.y).toBe(original!.y);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(
    page.locator('[data-onirigiri-pane-id="pane-2"]'),
  ).toHaveAttribute("data-focused", "true");
});

async function openFixture(page: Page) {
  await page.goto(`/@fs${repositoryRoot}tests/browser/pane-defaults.html`);
  await expect(
    page
      .frameLocator('[data-onirigiri-pane-id="frame"] iframe')
      .getByRole("textbox"),
  ).toBeVisible();
  await expect(
    page.locator('[data-onirigiri-slot="pane"][data-moving="true"]'),
  ).toHaveCount(0);
}

async function fittedBounds(page: Page, paneId: string, selector: string) {
  const pane = page.locator(`[data-onirigiri-pane-id="${paneId}"]`);
  return pane.evaluate((pane, selector) => {
    const bounds = (element: Element | null) => {
      if (!element)
        throw new Error(
          "Pane content must be mounted before measuring its fit",
        );
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      content: bounds(
        pane.querySelector('[data-onirigiri-slot="pane-live-content"]'),
      ),
      media: bounds(pane.querySelector(selector)),
    };
  }, selector);
}

function expectCentered(bounds: Awaited<ReturnType<typeof fittedBounds>>) {
  const { content, media } = bounds;
  expect(
    Math.abs(media.x + media.width / 2 - content.x - content.width / 2),
  ).toBeLessThan(2);
  expect(
    Math.abs(media.y + media.height / 2 - content.y - content.height / 2),
  ).toBeLessThan(2);
  expect(media.width / media.height).toBeCloseTo(16 / 9, 2);
}

test("contains, crops and stretches iframe content without resetting its document", async ({
  page,
}) => {
  await openFixture(page);
  const field = page
    .frameLocator('[data-onirigiri-pane-id="frame"] iframe')
    .getByRole("textbox");
  await field.fill("Preserve this edit through fitting");
  const contained = await fittedBounds(page, "frame", "iframe");
  expectCentered(contained);
  expect(contained.media.height).toBeLessThan(contained.content.height / 2);
  expect(contained.media.width).toBeLessThanOrEqual(contained.content.width);
  await page.evaluate(() =>
    window.__paneDefaultsFixture.configure({
      width: 500,
      height: 700,
      content: { aspectRatio: 16 / 9, fit: "cover" },
    }),
  );
  await expect(
    page.locator(
      '[data-onirigiri-pane-id="frame"] [data-onirigiri-slot="pane-live-content"]',
    ),
  ).toHaveAttribute("data-onirigiri-content-fit", "cover");
  const covered = await fittedBounds(page, "frame", "iframe");
  expectCentered(covered);
  expect(covered.media.width).toBeGreaterThan(covered.content.width * 2);
  expect(covered.media.height).toBeGreaterThanOrEqual(
    covered.content.height - 1,
  );
  await expect(field).toHaveValue("Preserve this edit through fitting");
  await page.evaluate(() =>
    window.__paneDefaultsFixture.configure({
      width: 500,
      height: 700,
      content: { aspectRatio: 16 / 9, fit: "fill" },
    }),
  );
  await expect(
    page.locator(
      '[data-onirigiri-pane-id="frame"] [data-onirigiri-slot="pane-live-content"]',
    ),
  ).toHaveAttribute("data-onirigiri-content-fit", "fill");
  const filled = await fittedBounds(page, "frame", "iframe");
  expect(filled.media.width).toBeCloseTo(filled.content.width, 0);
  expect(filled.media.height).toBeCloseTo(filled.content.height, 0);
  await expect(field).toHaveValue("Preserve this edit through fitting");
});

test("keeps native video complete while panes and the browser change size", async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(() =>
    window.__paneDefaultsFixture.handle.current!.focusPane("video"),
  );
  const video = page.locator('[data-onirigiri-pane-id="video"] video');
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).videoWidth),
    )
    .toBe(960);
  await expect(
    page.locator('[data-onirigiri-slot="pane"][data-moving="true"]'),
  ).toHaveCount(0);
  const identity = await video.elementHandle();
  for (const [width, height] of [
    [500, 700],
    [1100, 450],
    [500, 700],
  ]) {
    await page.evaluate(
      ({ width, height }) =>
        window.__paneDefaultsFixture.configure({
          width,
          height,
          content: { aspectRatio: 16 / 9, fit: "contain" },
        }),
      { width: width!, height: height! },
    );
    await expect(page.locator('[data-onirigiri-pane-id="video"]')).toHaveCSS(
      "width",
      `${width}px`,
    );
    const bounds = await fittedBounds(page, "video", "video");
    expectCentered(bounds);
    expect(bounds.media.width).toBeLessThanOrEqual(bounds.content.width + 1);
    expect(bounds.media.height).toBeLessThanOrEqual(bounds.content.height + 1);
    await expect(video).toHaveCSS("object-fit", "contain");
  }
  await page.setViewportSize({ width: 640, height: 500 });
  await expect(
    page.locator('[data-onirigiri-slot="pane"][data-moving="true"]'),
  ).toHaveCount(0);
  const smaller = await fittedBounds(page, "video", "video");
  expectCentered(smaller);
  expect(smaller.media.width).toBeLessThanOrEqual(smaller.content.width + 1);
  expect(smaller.media.height).toBeLessThanOrEqual(smaller.content.height + 1);
  expect(await identity!.evaluate((element) => element.isConnected)).toBe(true);
  await page.screenshot({ path: "/tmp/onirigiri-contained-video.png" });
});
