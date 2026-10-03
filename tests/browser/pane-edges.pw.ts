import { expect, test, type Locator, type Page } from "@playwright/test";

import type { PaneDefaultsFixture } from "./pane-defaults";
import { startTwoDimensionalDevServer } from "./two-dimensional-dev-server";

let server: Awaited<ReturnType<typeof startTwoDimensionalDevServer>>;

test.beforeAll(async () => {
  server = await startTwoDimensionalDevServer();
});

test.afterAll(async () => {
  await server?.close();
});

function fixtureUrl(query = ""): string {
  return `${server.origin}/@fs${server.repositoryRoot}tests/browser/pane-defaults.html${query}`;
}

async function settled(page: Page) {
  await expect(
    page.locator('[data-onirigiri-slot="pane"][data-moving="true"]'),
  ).toHaveCount(0);
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Missing element bounds");
  return bounds;
}

async function openEdgeFixture(page: Page) {
  await page.setViewportSize({ height: 1000, width: 1600 });
  await page.goto(fixtureUrl());
  await page.evaluate(() =>
    (
      window as Window & { __paneDefaultsFixture: PaneDefaultsFixture }
    ).__paneDefaultsFixture.configure({
      height: 600,
      resizeEdges: ["left", "right", "top", "bottom"],
      width: 500,
    }),
  );
  const frame = page.locator('[data-onirigiri-pane-id="frame"]');
  await expect(frame).toHaveAttribute("data-focused", "true");
  await settled(page);
  return frame;
}

async function drag(
  page: Page,
  handle: Locator,
  deltaX: number,
  deltaY: number,
  during: () => Promise<void>,
) {
  const start = await box(handle);
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 6 });
  await during();
  await page.mouse.up();
}

test("left and top handles sit on their edges with resize cursors", async ({
  page,
}) => {
  const frame = await openEdgeFixture(page);
  const pane = await box(frame);
  const left = frame.locator('[data-resize-edge="left"]');
  const top = frame.locator('[data-resize-edge="top"]');
  await expect(left).toHaveAttribute(
    "data-onirigiri-slot",
    "pane-resize-column",
  );
  await expect(top).toHaveAttribute("data-onirigiri-slot", "pane-resize-row");
  const leftBox = await box(left);
  const topBox = await box(top);
  expect(Math.abs(leftBox.x - pane.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(leftBox.height - pane.height)).toBeLessThanOrEqual(1);
  expect(leftBox.width).toBeCloseTo(8, 0);
  expect(Math.abs(topBox.y - pane.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(topBox.width - pane.width)).toBeLessThanOrEqual(1);
  expect(topBox.height).toBeCloseTo(8, 0);
  expect(
    await left.evaluate((element) => getComputedStyle(element).cursor),
  ).toBe("ew-resize");
  expect(
    await top.evaluate((element) => getComputedStyle(element).cursor),
  ).toBe("ns-resize");
  await expect(frame.locator('[data-resize-edge="right"]')).toHaveCount(1);
  await expect(frame.locator('[data-resize-edge="bottom"]')).toHaveCount(1);
});

test("dragging the left edge holds the right edge while the width follows the pointer", async ({
  page,
}) => {
  const frame = await openEdgeFixture(page);
  const before = await box(frame);
  await drag(
    page,
    frame.locator('[data-resize-edge="left"]'),
    -120,
    0,
    async () => {
      await expect
        .poll(async () => Math.round((await box(frame)).width))
        .toBe(Math.round(before.width + 120));
      const during = await box(frame);
      expect(
        Math.abs(during.x + during.width - (before.x + before.width)),
      ).toBeLessThanOrEqual(1);
      expect(Math.abs(during.x - (before.x - 120))).toBeLessThanOrEqual(1);
    },
  );
  await settled(page);
  expect(Math.round((await box(frame)).width)).toBe(
    Math.round(before.width + 120),
  );
});

test("dragging the top edge holds the bottom edge while the height follows the pointer", async ({
  page,
}) => {
  const frame = await openEdgeFixture(page);
  const before = await box(frame);
  await drag(
    page,
    frame.locator('[data-resize-edge="top"]'),
    0,
    -80,
    async () => {
      await expect
        .poll(async () => Math.round((await box(frame)).height))
        .toBe(Math.round(before.height + 80));
      const during = await box(frame);
      expect(
        Math.abs(during.y + during.height - (before.y + before.height)),
      ).toBeLessThanOrEqual(1);
    },
  );
  await settled(page);
  expect(Math.round((await box(frame)).height)).toBe(
    Math.round(before.height + 80),
  );
});

test("a pane link opens on its pane without a camera flight and follows focus", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const record = window as Window & { __sawMovingPane?: boolean };
    new MutationObserver((mutations) => {
      if (
        mutations.some(
          (mutation) =>
            mutation.target instanceof Element &&
            mutation.target.getAttribute("data-moving") === "true",
        )
      ) {
        record.__sawMovingPane = true;
      }
    }).observe(document, {
      attributeFilter: ["data-moving"],
      attributes: true,
      subtree: true,
    });
  });
  await page.setViewportSize({ height: 1000, width: 1600 });
  await page.goto(fixtureUrl("?link=1&pane=video#here"));
  const video = page.locator('[data-onirigiri-pane-id="video"]');
  await expect(video).toHaveAttribute("data-focused", "true");
  await settled(page);
  const stage = await box(page.locator('[data-onirigiri-slot="stage"]'));
  const videoBox = await box(video);
  expect(
    Math.abs(videoBox.x + videoBox.width / 2 - (stage.x + stage.width / 2)),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => (window as Window & { __sawMovingPane?: boolean }).__sawMovingPane,
    ),
  ).toBeUndefined();

  await page
    .locator('[data-onirigiri-pane-id="frame"] .onirigiri-pane__titlebar')
    .click();
  await expect(
    page.locator('[data-onirigiri-pane-id="frame"]'),
  ).toHaveAttribute("data-focused", "true");
  await expect(page).toHaveURL(/\?link=1&pane=frame#here$/);

  await page.goto(fixtureUrl("?link=1&pane=unknown"));
  await expect(
    page.locator('[data-onirigiri-pane-id="frame"]'),
  ).toHaveAttribute("data-focused", "true");
  await expect(page).toHaveURL(/\?link=1&pane=unknown$/);
});
