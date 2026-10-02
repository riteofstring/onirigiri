import { expect, test } from "@playwright/test";

for (const kind of ["reactor", "tidal"]) {
  test(`lab ${kind} stays native, resizes and preserves its document through navigation`, async ({
    page,
  }) => {
    await page.goto(`/?count=5&content=lab:three-${kind}`);
    const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
    const iframe = pane.locator("iframe");
    const frame = iframe.contentFrame();
    const canvas = frame.locator(".three-viewport canvas[aria-label]");
    await expect(canvas).toBeVisible();
    await expect(iframe).toHaveAttribute("data-consumer-ready", "true");
    await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
    const original = await iframe.evaluateHandle(
      (element: HTMLIFrameElement) => element.contentDocument,
    );
    const energy = frame.getByRole("slider");
    await energy.evaluate((element: HTMLInputElement) => {
      element.value = "1.5";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const hostTheme = await page
      .locator(".playground-header")
      .evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          family: styles.fontFamily,
          heading: styles
            .getPropertyValue("--playground-font-size-heading")
            .trim(),
        };
      });
    await expect(frame.locator(".three-header h2")).toHaveCSS(
      "font-family",
      hostTheme.family,
    );
    await expect(frame.locator(".three-header h2")).toHaveCSS(
      "font-size",
      hostTheme.heading,
    );
    const more = page.locator(".playground-more-menu");
    await more.locator(":scope > summary").click();
    for (const mode of ["light", "dark"]) {
      const toggle = page.getByRole("button", {
        name: `Use ${mode} mode`,
        exact: true,
      });
      if (await toggle.count()) await toggle.click();
      await expect(frame.locator("html")).toHaveAttribute(
        "data-color-mode",
        mode,
      );
      await expect(iframe).toHaveAttribute("data-consumer-ready", "true");
      const surface = await frame
        .locator(".three-demo")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      const hostSurface = await page
        .locator(".playground-header")
        .evaluate((element) =>
          getComputedStyle(element)
            .getPropertyValue("--playground-surface")
            .trim(),
        );
      expect(surface).toBe(hostSurface);
    }
    await more.locator(":scope > summary").click();
    const before = await canvas.screenshot();
    await page.waitForTimeout(150);
    expect((await canvas.screenshot()).equals(before)).toBe(false);
    await pane.getByRole("button", { name: "Maximize pane" }).click();
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 700, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          canvas.evaluate((element: HTMLCanvasElement) =>
            Math.abs(
              element.width / element.height -
                element.clientWidth / element.clientHeight,
            ),
          ),
        )
        .toBeLessThan(0.005);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await pane.getByRole("button", { name: "Restore pane" }).click();
    const menu = page.locator(".playground-renderer-menu");
    await menu.locator("summary").click();
    await menu.getByRole("checkbox", { name: "Always live" }).uncheck();
    await menu.locator("summary").click();
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(pane).toHaveAttribute("data-focused", "true");
    expect(
      await iframe.evaluate(
        (element: HTMLIFrameElement, document) =>
          element.contentDocument === document,
        original,
      ),
    ).toBe(true);
    await expect(energy).toHaveValue("1.5");
    await expect(frame.getByRole("alert")).toBeHidden();
    await original.dispose();
  });
}

for (const kind of ["prism", "orbit"]) {
  test(`arcade ${kind} accepts game controls and preserves its canvas through overview`, async ({
    page,
  }) => {
    await page.goto(`/?count=5&content=arcade:${kind}`);
    const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
    const canvas = pane.locator(".arcade-game-field canvas");
    await expect(canvas).toBeVisible();
    await canvas.evaluate((element) => {
      (window as unknown as { arcadeOriginal: Element }).arcadeOriginal =
        element;
    });
    await pane.getByRole("button", { name: "Play", exact: false }).click();
    await expect(pane.locator(".arcade-game-prompt")).toHaveCount(0);
    await canvas.press("ArrowRight");
    const before = Number(await canvas.getAttribute("data-arcade-ticks"));
    await page
      .getByRole("button", {
        name: "Zoom out to workspace overview",
        exact: true,
      })
      .click();
    await expect(
      page.locator('[data-onirigiri-slot="workspace"]'),
    ).toHaveAttribute("data-presentation-mode", "overview");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-arcade-ticks")))
      .toBeGreaterThan(before + 5);
    await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
    expect(
      await canvas.evaluate(
        (element) =>
          element ===
          (window as unknown as { arcadeOriginal: Element }).arcadeOriginal,
      ),
    ).toBe(true);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });
}
