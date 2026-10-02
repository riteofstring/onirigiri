import { expect, test, type Page } from "@playwright/test";

import type { PaneDefaultsFixture } from "./pane-defaults";
import { startTwoDimensionalDevServer } from "./two-dimensional-dev-server";

let server: Awaited<ReturnType<typeof startTwoDimensionalDevServer>>;

test.beforeAll(async () => {
  server = await startTwoDimensionalDevServer();
});

test.afterAll(async () => {
  await server?.close();
});

async function paneAndStage(page: Page, paneId: string) {
  return page.evaluate((paneId) => {
    const bounds = (element: Element | null) => {
      if (!element) throw new Error("Missing workspace element");
      const { height, width } = element.getBoundingClientRect();
      return { height: Math.round(height), width: Math.round(width) };
    };
    return {
      pane: bounds(
        document.querySelector(`[data-onirigiri-pane-id="${paneId}"]`),
      ),
      stage: bounds(document.querySelector('[data-onirigiri-slot="stage"]')),
    };
  }, paneId);
}

async function settled(page: Page) {
  await expect(
    page.locator('[data-onirigiri-slot="pane"][data-moving="true"]'),
  ).toHaveCount(0);
  await page.waitForTimeout(100);
}

test("maximize and full sizing fill the viewport despite pane size limits", async ({
  page,
}) => {
  await page.setViewportSize({ height: 1300, width: 1600 });
  await page.goto(
    `${server.origin}/@fs${server.repositoryRoot}tests/browser/pane-defaults.html`,
  );
  await page.evaluate(() =>
    (
      window as Window & { __paneDefaultsFixture: PaneDefaultsFixture }
    ).__paneDefaultsFixture.configure({
      height: 700,
      maxHeight: 900,
      width: 500,
    }),
  );
  const frame = page.locator('[data-onirigiri-pane-id="frame"]');
  await expect(frame).toBeVisible();
  await settled(page);
  const limited = await paneAndStage(page, "frame");
  expect(limited.pane.height).toBeLessThanOrEqual(900);
  const padding = 10;
  const filled = {
    height: limited.stage.height - padding * 2,
    width: limited.stage.width - padding * 2,
  };
  expect(filled.height).toBeGreaterThan(900);

  await frame.getByRole("button", { name: "Maximize pane" }).click();
  await expect(frame).toHaveAttribute("data-maximized", "true");
  await settled(page);
  expect((await paneAndStage(page, "frame")).pane).toEqual(filled);

  await frame.getByRole("button", { name: "Restore pane" }).click();
  await expect(frame).toHaveAttribute("data-maximized", "false");
  await settled(page);
  expect((await paneAndStage(page, "frame")).pane).toEqual(limited.pane);

  await page.evaluate(() =>
    (
      window as Window & { __paneDefaultsFixture: PaneDefaultsFixture }
    ).__paneDefaultsFixture.handle.current?.resizePanes("full"),
  );
  await settled(page);
  expect((await paneAndStage(page, "frame")).pane).toEqual(filled);

  await page.evaluate(() =>
    (
      window as Window & { __paneDefaultsFixture: PaneDefaultsFixture }
    ).__paneDefaultsFixture.handle.current?.resizePanes("default"),
  );
  await settled(page);
  expect((await paneAndStage(page, "frame")).pane).toEqual(limited.pane);
});
