import { expect, test, type Page } from "@playwright/test";

import type { NativeMotionFixture } from "./native-content-scene";
import { startTwoDimensionalDevServer } from "./two-dimensional-dev-server";

let server: Awaited<ReturnType<typeof startTwoDimensionalDevServer>>;

test.use({ deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } });

test.beforeAll(async () => {
  server = await startTwoDimensionalDevServer();
});

test.afterAll(async () => {
  await server?.close();
});

function focusNativePane(page: Page, paneId: string) {
  return page.evaluate((id) => {
    const fixture = Reflect.get(
      window,
      "__nativeMotionFixture",
    ) as NativeMotionFixture;
    return fixture.handle.current!.focusPane(id);
  }, paneId);
}

function toggleNativeOverview(page: Page) {
  return page.evaluate(() => {
    const fixture = Reflect.get(
      window,
      "__nativeMotionFixture",
    ) as NativeMotionFixture;
    fixture.handle.current!.toggleOverview();
  });
}

for (const overview of [false, true]) {
  test(`offscreen default titlebars return with their native content (overview=${overview})`, async ({
    page,
  }) => {
    await page.goto(
      `${server.origin}/@fs${server.repositoryRoot}tests/browser/native-content-guard.html?liveContent&auto&count=12&preloadMargin=0`,
    );
    const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
    const titlebar = pane.locator('[data-onirigiri-slot="pane-titlebar"]');
    const input = pane.frameLocator("iframe").getByRole("textbox");
    await input.fill("Retained through titlebar culling");
    const originalTitlebar = await titlebar.elementHandle();
    const originalFrame = await pane.locator("iframe").elementHandle();
    if (overview) await toggleNativeOverview(page);
    await focusNativePane(page, "pane-12");
    await expect(pane).toHaveAttribute("data-visible", "false");
    await expect(titlebar).toHaveCSS("visibility", "hidden");
    await expect(
      pane.locator('[data-onirigiri-slot="pane-actions"]'),
    ).toHaveCSS("visibility", "hidden");
    expect(
      await titlebar.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBeGreaterThan(0);
    await expect(pane).toHaveCSS("visibility", "visible");
    expect(await originalFrame!.evaluate((frame) => frame.isConnected)).toBe(
      true,
    );
    await focusNativePane(page, "pane-1");
    await expect(pane).toHaveAttribute("data-moving", "false");
    await expect(pane).toHaveAttribute("data-visible", "true");
    await expect(titlebar).toBeVisible();
    expect(
      await titlebar.evaluate(
        (element, original) => element === original,
        originalTitlebar,
      ),
    ).toBe(true);
    expect(
      await pane
        .locator("iframe")
        .evaluate((element, original) => element === original, originalFrame),
    ).toBe(true);
    if (overview) await toggleNativeOverview(page);
    await expect(input).toHaveValue("Retained through titlebar culling");
    await expect(
      pane.getByRole("button", { name: "Maximize pane" }),
    ).toBeVisible();
  });
}

for (const host of ["content", "accessory", "action"]) {
  test(`offscreen titlebar culling retains a closed-shadow ${host} popover`, async ({
    page,
  }) => {
    await page.goto(
      `${server.origin}/@fs${server.repositoryRoot}tests/browser/native-content-guard.html?liveContent&auto&count=12&preloadMargin=0&popoverHost=${host}`,
    );
    const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
    await expect(
      pane.frameLocator("iframe").getByRole("textbox"),
    ).toBeVisible();
    const popover = await pane
      .locator(`[data-fixture-popover-host="${host}"]`)
      .first()
      .evaluateHandle((element) => {
        const shadow = element.attachShadow({ mode: "closed" });
        shadow.append(document.createElement("slot"));
        const popup = document.createElement("div");
        popup.popover = "manual";
        popup.style.cssText =
          "position:fixed;inset:30px auto auto 30px;margin:0;width:80px;height:48px;padding:0;border:0;background:rgb(29,209,161)";
        shadow.append(popup);
        popup.showPopover();
        return popup;
      });
    try {
      const clip = { x: 40, y: 40, width: 20, height: 20 };
      const shown = await page.screenshot({ clip });
      await focusNativePane(page, "pane-12");
      await expect(pane).toHaveAttribute("data-visible", "false");
      await expect(pane).toHaveAttribute("data-moving", "false");
      expect(
        await popover.evaluate((popup) => ({
          open: popup.matches(":popover-open"),
          visible: getComputedStyle(popup).visibility,
          connected: popup.isConnected,
        })),
      ).toEqual({ open: true, visible: "visible", connected: true });
      expect((await page.screenshot({ clip })).equals(shown)).toBe(
        host !== "content",
      );
      await popover.evaluate((popup) => popup.hidePopover());
      expect((await page.screenshot({ clip })).equals(shown)).toBe(false);
      await focusNativePane(page, "pane-1");
      await expect(pane).toHaveAttribute("data-moving", "false");
      await popover.evaluate((popup) => popup.showPopover());
      expect((await page.screenshot({ clip })).equals(shown)).toBe(true);
    } finally {
      await popover.evaluate((popup) => popup.remove());
      await popover.dispose();
    }
  });
}
