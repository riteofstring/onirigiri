import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { launchPlaygroundPreview } from "./preview-playground.mjs";

const output = await mkdtemp(join(tmpdir(), "onirigiri-playground-content-"));
for (const example of ["one-dimensional", "two-dimensional"]) {
  const preview = await launchPlaygroundPreview({
    example,
    fixtureOrigin: "http://127.0.0.1:5197",
    fixturePath: "/tests/browser/native-content-frame.html",
    protocol: "onirigiri-native-test/v1",
  });
  const { page } = preview;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const panes = page.locator('[data-onirigiri-slot="pane"]');
  const notes = page.locator('[data-onirigiri-pane-id="pane-2"]');
  const first = page.locator('[data-onirigiri-pane-id="pane-1"]');
  const spawnMenu = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Spawn panes" }) });
  const contentMenu = page.locator(".playground-content-menu");
  const workspace = page.locator(".onirigiri-workspace");

  async function expectUniformPaneSizes() {
    const stage = await page
      .locator('[data-onirigiri-slot="stage"]')
      .boundingBox();
    assert(stage);
    const expected = {
      width: 480,
      height: example === "two-dimensional" ? 600 : stage.height - 20,
    };
    await expect
      .poll(async () => {
        const sizes = await panes.evaluateAll((elements) =>
          elements.map((element) => {
            const { width, height } = element.getBoundingClientRect();
            return { width, height };
          }),
        );
        return (
          sizes.length > 0 &&
          sizes.every(
            ({ width, height }) =>
              Math.abs(width - expected.width) < 0.01 &&
              Math.abs(height - expected.height) < 0.01,
          )
        );
      })
      .toBe(true);
  }

  async function spawn(count) {
    await spawnMenu.locator("summary").click();
    await spawnMenu
      .getByRole("button", { name: `${count} panes`, exact: true })
      .click();
    await expect(panes).toHaveCount(count);
    await expect(spawnMenu).not.toHaveAttribute("open", "");
    await expect(first).toHaveAttribute("data-focused", "true");
    await expectUniformPaneSizes();
  }

  async function expectNativeAndRetained(pane) {
    const rendering = page.locator(".playground-renderer-menu");
    const live = rendering.getByRole("checkbox", {
      name: "Always live",
      exact: true,
    });
    await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
    await expect(pane).toHaveAttribute(
      "data-onirigiri-presentation-live",
      "true",
    );
    await rendering.locator(":scope > summary").click();
    await expect(live).toBeChecked();
    await live.uncheck();
    await page.keyboard.press("Escape");
    await expect(pane).toHaveAttribute("data-onirigiri-picture-ready", "true", {
      timeout: 15_000,
    });
    await rendering.locator(":scope > summary").click();
    await live.check();
    await page.keyboard.press("Escape");
    await expect(pane).toHaveAttribute(
      "data-onirigiri-presentation-live",
      "true",
    );
    await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
  }

  async function chooseContent(labels) {
    await contentMenu.locator("summary").click();
    await contentMenu
      .getByRole("button", { name: "Clear all", exact: true })
      .click();
    await expect(
      contentMenu.getByRole("button", { name: "Apply content", exact: true }),
    ).toBeDisabled();
    for (const label of labels)
      await contentMenu
        .getByRole("checkbox", { name: label, exact: true })
        .check();
    await contentMenu
      .getByRole("button", { name: "Apply content", exact: true })
      .click();
    await expect(contentMenu).not.toHaveAttribute("open", "");
    await expectUniformPaneSizes();
  }

  try {
    await expect(panes).toHaveCount(10);
    await expectUniformPaneSizes();
    await expect(
      page.locator('[data-onirigiri-surface-kind="welcome"]'),
    ).toHaveCount(1);
    await expect(
      first.getByRole("heading", { name: "Start here." }),
    ).toBeVisible();
    await expect(first.locator("textarea")).toHaveCount(0);
    const modifier = await page.evaluate(() =>
      /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "Option" : "Alt",
    );
    await expect(
      first.locator("kbd").filter({ hasText: modifier }),
    ).toHaveCount(2);
    await first.getByRole("button", { name: "Explore panes" }).click();
    await expect(notes).toHaveAttribute("data-focused", "true");
    await workspace.focus();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(first).toHaveAttribute("data-focused", "true");
    await expect(page.locator(".playground-frame-rate")).toHaveText(/\d+ FPS/);
    await expect(
      page.getByRole("navigation", { name: "Examples" }),
    ).toHaveCount(0);
    if (example === "one-dimensional") {
      await workspace.focus();
      for (const key of ["Alt+ArrowUp", "Alt+ArrowDown"]) {
        await page.keyboard.press(key);
        await expect(first).toHaveAttribute("data-focused", "true");
      }
      for (const height of [900, 740, 900]) {
        await page.setViewportSize({ width: 1280, height });
        await expect
          .poll(async () => {
            const stage = await page
              .locator('[data-onirigiri-slot="stage"]')
              .boundingBox();
            const pane = await first.boundingBox();
            return Math.abs(pane.height - stage.height + 20);
          })
          .toBeLessThan(2);
      }
    }
    for (const viewport of [
      { width: 1790, height: 900 },
      { width: 1024, height: 650 },
      { width: 640, height: 450 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      const controls = page.locator(
        ".playground-primary-actions > button, .playground-primary-actions > details > summary, .playground-shortcuts-trigger, .playground-more-menu > summary",
      );
      for (const control of await controls.all()) {
        await expect(control).toBeInViewport({ ratio: 1 });
        assert.equal(
          await control.evaluate(
            (node) => node.scrollWidth <= node.clientWidth,
          ),
          true,
        );
      }
      await contentMenu.locator("summary").click();
      const panel = contentMenu.locator(".playground-add-menu__panel");
      await expect(panel).toBeInViewport({ ratio: 1 });
      const list = contentMenu.locator(".playground-content-menu__types");
      await list.hover();
      await page.mouse.wheel(0, 1000);
      await expect
        .poll(() => list.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(0);
      const lastType = list.getByRole("checkbox").last();
      await expect(lastType).toBeInViewport({ ratio: 1 });
      await lastType.uncheck();
      await expect(lastType).not.toBeChecked();
      await lastType.check();
      await expect(
        contentMenu.getByRole("button", { name: "Apply content" }),
      ).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("Escape");
      await expect(contentMenu).not.toHaveAttribute("open", "");
      await expect(contentMenu.locator("summary")).toBeFocused();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await contentMenu.locator("summary").click();
    await page.locator(".playground-brand h1").click();
    await expect(contentMenu).not.toHaveAttribute("open", "");
    await contentMenu.locator("summary").click();
    await spawnMenu.locator("summary").click();
    await expect(contentMenu).not.toHaveAttribute("open", "");
    await expect(spawnMenu).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", {
        name: "Zoom out to workspace overview",
        exact: true,
      })
      .click();
    await contentMenu.locator("summary").click();
    const overviewList = contentMenu.locator(".playground-content-menu__types");
    await overviewList.evaluate((node) => (node.scrollTop = 0));
    await overviewList.hover();
    await page.mouse.wheel(0, 1000);
    await expect
      .poll(() => overviewList.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("button", {
        name: "Zoom in to focused pane",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Zoom in to focused pane", exact: true })
      .click();
    await first.getByRole("button", { name: "Explore panes" }).click();
    await notes.locator("textarea").click();
    await notes.locator("textarea").fill("Keep this draft through overview.");
    await page
      .getByRole("button", {
        name: "Zoom out to workspace overview",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Zoom in to focused pane", exact: true })
      .click();
    await expect(notes.locator("textarea")).toHaveValue(
      "Keep this draft through overview.",
    );
    await spawn(5);
    await first.getByRole("button", { name: "Explore panes" }).click();
    const oldField = await notes.locator("textarea").elementHandle();
    assert(oldField);
    await notes.locator("textarea").click();
    await notes.locator("textarea").fill("Reset this draft.");
    await spawn(5);
    assert.equal(await oldField.evaluate((node) => node.isConnected), false);
    await first.getByRole("button", { name: "Explore panes" }).click();
    await expect(notes.locator("textarea")).not.toHaveValue(
      "Reset this draft.",
    );
    for (const count of [10, 50, 100]) await spawn(count);
    await expect(page.locator(".onirigiri-pane[hidden]")).toHaveCount(0);
    await spawn(10);
    await chooseContent(["Video"]);
    const videoFrame = first.locator('iframe[data-consumer-ready="true"]');
    await expect(videoFrame).toBeVisible();
    const contentBounds = await first
      .locator('[data-onirigiri-slot="pane-live-content"]')
      .boundingBox();
    const videoBounds = await videoFrame.boundingBox();
    assert(Math.abs(videoBounds.width / videoBounds.height - 16 / 9) < 0.01);
    assert(videoBounds.width <= contentBounds.width + 1);
    assert(videoBounds.height <= contentBounds.height + 1);
    assert(
      Math.abs(
        videoBounds.y +
          videoBounds.height / 2 -
          contentBounds.y -
          contentBounds.height / 2,
      ) < 2,
    );
    if (example === "one-dimensional") {
      await page.getByRole("button", { name: "Add pane", exact: true }).click();
    } else {
      const addMenu = page.locator(".playground-add-menu").filter({
        has: page.locator("summary", { hasText: /^Add$/ }),
      });
      await addMenu.locator("summary").click();
      await addMenu
        .getByRole("button", { name: "Pane right", exact: true })
        .click();
      await page.keyboard.press("Escape");
    }
    await expect(panes).toHaveCount(11);
    await expectUniformPaneSizes();
    await chooseContent(["Field notes", "Forms"]);
    await expect(
      page.locator('[data-onirigiri-surface-kind="notes"]'),
    ).toHaveCount(5);
    await expect(
      page.locator('[data-onirigiri-surface-kind="lab:forms"]'),
    ).toHaveCount(5);
    await workspace.focus();
    await page.keyboard.press("Alt+ArrowRight");
    const labPane = page.locator('[data-onirigiri-pane-id="pane-2"]');
    await expect(labPane).toHaveAttribute("data-focused", "true");
    const frameElement = labPane.locator('iframe[data-consumer-ready="true"]');
    await expect(frameElement).toBeVisible();
    const frame = await (await frameElement.elementHandle()).contentFrame();
    await frame
      .getByRole("textbox", { name: "Retained value" })
      .fill("Keep this form through theme changes.");
    const documentIdentity = await frame.evaluate(() => {
      window.__themeDocumentId = crypto.randomUUID();
      return window.__themeDocumentId;
    });
    for (const mode of ["dark", "light"]) {
      const more = page.locator(".playground-more-menu");
      if ((await more.getAttribute("open")) === null)
        await more.locator(":scope > summary").click();
      const toggle = page.getByRole("button", {
        name: `Use ${mode} mode`,
        exact: true,
      });
      if (await toggle.count()) await toggle.click();
      if ((await more.getAttribute("open")) !== null)
        await more.locator(":scope > summary").click();
      await expect(page.locator(".playground-shell")).toHaveAttribute(
        "data-color-mode",
        mode,
      );
      await workspace.focus();
      await frame.waitForFunction(
        (mode) => document.documentElement.dataset.colorMode === mode,
        mode,
      );
      const background = await page
        .locator(".playground-header")
        .evaluate((node) =>
          getComputedStyle(node)
            .getPropertyValue("--playground-surface")
            .trim(),
        );
      await expect(frame.locator("html")).toHaveCSS(
        "background-color",
        background,
      );
      await expectNativeAndRetained(labPane);
      await expect(
        frame.getByRole("textbox", { name: "Retained value" }),
      ).toHaveValue("Keep this form through theme changes.");
      assert.equal(
        await frame.evaluate(() => window.__themeDocumentId),
        documentIdentity,
      );
      assert.equal(
        await frame.evaluate(
          () => getComputedStyle(document.documentElement).fontFamily,
        ),
        await page
          .locator(".playground-header")
          .evaluate((node) => getComputedStyle(node).fontFamily),
      );
      await page.screenshot({ path: join(output, `${example}-${mode}.png`) });
    }
    await chooseContent(["Forms"]);
    await expect(
      page.locator('[data-onirigiri-surface-kind="lab:forms"]'),
    ).toHaveCount(10);
    await expect(
      page.locator('[data-onirigiri-surface-kind="notes"]'),
    ).toHaveCount(0);
    await spawn(50);
    await expect(
      page.locator('[data-onirigiri-surface-kind="lab:forms"]'),
    ).toHaveCount(50);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-preview-mode="mobile"]')).toBeVisible();
    await contentMenu.locator("summary").click();
    await expect
      .poll(async () => {
        const bounds = await contentMenu
          .locator(".playground-add-menu__panel")
          .boundingBox();
        return Boolean(
          bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390,
        );
      })
      .toBe(true);
    await page.screenshot({ path: join(output, `${example}-mobile.png`) });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.keyboard.press("Escape");
    await expect(contentMenu).not.toHaveAttribute("open", "");
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.deepEqual(errors, []);
    process.stdout.write(
      `${example}: counts, content selection, navigation, capture and live theme changes passed.\n`,
    );
  } finally {
    await preview.close();
  }
}
process.stdout.write(`Playground content screenshots: ${output}\n`);
