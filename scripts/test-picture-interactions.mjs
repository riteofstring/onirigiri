import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { join } from "node:path";
import { launchRetainedPicturePreview } from "./preview-retained-capture.mjs";

export async function verifyResizeInteractions(output) {
  const preview = await launchRetainedPicturePreview({
    count: 100,
    contentBudget: 8,
  });
  try {
    await verifyAdjacentPreload(preview.page);
    await preview.page
      .locator('[data-onirigiri-picture-ready="true"]')
      .first()
      .waitFor();
    await verifyResizing(preview.page, output);
  } finally {
    await preview.close();
  }
}

async function verifyAdjacentPreload(page) {
  await page.evaluate(() => {
    window.__preloadMaximum = 0;
    const observe = () => {
      const active = [
        ...document.querySelectorAll('[data-onirigiri-preloading="true"]'),
      ];
      window.__preloadMaximum = Math.max(
        window.__preloadMaximum,
        active.length,
      );
      const content = active[0];
      const frame = content?.querySelector(
        'iframe[data-consumer-ready="true"]',
      );
      if (frame && !window.__preloadedFrame) {
        window.__preloadedFrame = frame;
        window.__preloadedPaneId = content.closest(
          "[data-onirigiri-pane-id]",
        ).dataset.onirigiriPaneId;
      }
    };
    window.__preloadObserver = new MutationObserver(observe);
    window.__preloadObserver.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
    });
    observe();
  });
  await page.waitForFunction(
    () => window.__preloadedFrame && !window.__preloadedFrame.isConnected,
    null,
    { timeout: 30_000 },
  );
  const paneId = await page.evaluate(() => window.__preloadedPaneId);
  const pane = page.locator(`[data-onirigiri-pane-id="${paneId}"]`);
  const picture = pane.locator('[data-onirigiri-slot="pane-picture"]');
  await expect(picture).toHaveCount(1);
  await expect(pane.locator("iframe")).toHaveCount(0);
  const beforeNavigation = await pane.boundingBox();
  const viewport = await page
    .locator('[data-onirigiri-slot="stage"]')
    .boundingBox();
  assert(
    beforeNavigation.x >= viewport.x + viewport.width ||
      beforeNavigation.x + beforeNavigation.width <= viewport.x ||
      beforeNavigation.y >= viewport.y + viewport.height ||
      beforeNavigation.y + beforeNavigation.height <= viewport.y,
    `The neighboring picture must be cached outside the viewport: ${JSON.stringify({ paneId, beforeNavigation, viewport })}`,
  );
  await page.evaluate(
    (id) => window.__retainedPreview.handle.current.focusPane(id),
    paneId,
  );
  await pane
    .locator('[data-onirigiri-slot="pane-live-content"]')
    .waitFor({ state: "visible" });
  await expect(
    pane.locator('[data-onirigiri-slot="pane-content"]'),
  ).toHaveAttribute("data-onirigiri-content-ready", "true");
  assert.equal(await pane.locator(".onirigiri-pane__placeholder").count(), 0);
  await expect(
    pane.locator('iframe[data-consumer-ready="true"]'),
  ).toBeVisible();
  await expect(picture).toHaveCount(1);
  assert.equal(
    await page.evaluate(
      (id) =>
        document.querySelector(`[data-onirigiri-pane-id="${id}"] iframe`) ===
        window.__preloadedFrame,
      paneId,
    ),
    false,
    "Navigation mounts a live document after the temporary capture document was unloaded",
  );
  assert.equal(await page.evaluate(() => window.__preloadMaximum), 1);
  await page.evaluate(() => {
    window.__preloadObserver.disconnect();
    window.__retainedPreview.handle.current.focusPane("pane-0");
  });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-onirigiri-pane-id="pane-0"]').dataset
        .moving === "false",
  );
}

async function verifyResizing(page, output) {
  const upper = page.locator('[data-onirigiri-pane-id="pane-0"]');
  const lower = page.locator('[data-onirigiri-pane-id="pane-1"]');
  const documents = [];
  for (const pane of [upper, lower]) {
    await pane.locator('iframe[data-consumer-ready="true"]').waitFor();
    await expect
      .poll(() =>
        pane
          .locator("iframe")
          .evaluate((frame) => frame.closest("canvas") === null),
      )
      .toBe(true);
    const frame = await (
      await pane.locator("iframe").elementHandle()
    ).contentFrame();
    const timeOrigin = await frame.evaluate(() => {
      document.querySelector("input").value = "Retained through resizing";
      return performance.timeOrigin;
    });
    documents.push({ frame, timeOrigin });
  }
  const width = (await upper.boundingBox()).width;
  await verifyResizeDrag(
    page,
    upper.locator('[data-onirigiri-slot="pane-resize-column"]'),
    "x",
    async (delta) => {
      for (const pane of [upper, lower]) {
        assertClose((await pane.boundingBox()).width, width + delta);
      }
    },
  );
  await focusPane(page, "pane-1");
  const rowBefore = await rowBounds(upper, lower);
  await verifyResizeDrag(
    page,
    lower.locator('[data-resize-kind="row"]'),
    "y",
    async (delta) => {
      const row = await rowBounds(upper, lower);
      assertClose(row.height, rowBefore.height + delta);
      assertClose(row.gap, rowBefore.gap);
    },
  );
  await focusPane(page, "pane-0");
  const splitBefore = await rowBounds(upper, lower);
  await verifyResizeDrag(
    page,
    upper.locator('[data-resize-kind="split"]'),
    "y",
    async (delta) => {
      const row = await rowBounds(upper, lower);
      assertClose(row.upper.height, splitBefore.upper.height + delta);
      assertClose(row.lower.height, splitBefore.lower.height - delta);
      assertClose(row.height, splitBefore.height);
      assertClose(row.gap, splitBefore.gap);
    },
  );
  for (let index = 0; index < 16; index++) {
    await page.setViewportSize({
      width: 1280 - index * 12,
      height: 900 - index * 8,
    });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(400);
  for (const { frame, timeOrigin } of documents) {
    assert.equal(
      await frame.locator("input").inputValue(),
      "Retained through resizing",
    );
    assert.equal(
      await frame.evaluate(() => performance.timeOrigin),
      timeOrigin,
    );
  }
  assert.equal(await page.locator('[data-onirigiri-slot="pane"]').count(), 100);
  await page.screenshot({ path: join(output, "resized-hundred-panes.png") });
}

async function verifyResizeDrag(page, handle, axis, verifyGeometry) {
  const bounds = await handle.boundingBox();
  const start = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  assert.equal(
    await handle.evaluate(
      (element, point) =>
        element.contains(document.elementFromPoint(point.x, point.y)),
      start,
    ),
    true,
    "The resize handle must receive the pointer gesture",
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  assert.equal(
    await handle.evaluate((element) => element.hasPointerCapture(1)),
    true,
  );
  await page.waitForTimeout(300);
  const pixels = await page
    .locator("canvas.onirigiri-pane__live-surface")
    .evaluateAll((canvases) =>
      canvases.map((canvas) => [
        canvas.width,
        canvas.height,
        canvas.clientWidth,
        canvas.clientHeight,
      ]),
    );
  await page.evaluate(() => {
    window.__resizeGaps = [];
    let previous;
    const tick = (time) => {
      if (previous !== undefined) window.__resizeGaps.push(time - previous);
      previous = time;
      window.__resizeFrame = requestAnimationFrame(tick);
    };
    window.__resizeFrame = requestAnimationFrame(tick);
  });
  const before = await page.evaluate(
    () => window.__retainedPreview.handle.current.getCaptureStatus().accepted,
  );
  for (let index = 1; index <= 20; index++) {
    const position = { ...start, [axis]: start[axis] + index * 5 };
    await page.mouse.move(position.x, position.y);
    await page.waitForTimeout(20);
    await verifyFocusGeometry(handle);
  }
  await verifyGeometry(100);
  const reversed = { ...start, [axis]: start[axis] - 80 };
  await page.mouse.move(reversed.x, reversed.y);
  await page.waitForTimeout(40);
  await verifyFocusGeometry(handle);
  await verifyGeometry(-80);
  assert.equal(
    await page.evaluate(
      () => window.__retainedPreview.handle.current.getCaptureStatus().accepted,
    ),
    before,
    "Resizing must not dispatch picture work",
  );
  assert.equal(
    await page.locator('[data-onirigiri-overview-capture="true"]').count(),
    0,
  );
  assert.equal(
    await page.locator('[data-onirigiri-preloading="true"]').count(),
    0,
  );
  assert.deepEqual(
    await page
      .locator("canvas.onirigiri-pane__live-surface")
      .evaluateAll((canvases) =>
        canvases.map((canvas) => [
          canvas.width,
          canvas.height,
          canvas.clientWidth,
          canvas.clientHeight,
        ]),
      ),
    pixels,
    "Held resizing keeps canvas pixels at their original display size without reallocating their buffers",
  );
  const gaps = await page.evaluate(() => {
    cancelAnimationFrame(window.__resizeFrame);
    return window.__resizeGaps;
  });
  gaps.sort((a, b) => a - b);
  assert(gaps.length >= 20, `${axis} resizing must measure at least 20 frames`);
  assert(
    gaps[Math.floor(gaps.length * 0.95)] <= (1000 / 60) * 1.1,
    `${axis} resizing missed the 60 Hz frame budget`,
  );
  assert(
    gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length <= 1000 / 60 + 0.1,
    `${axis} resizing missed the 60 Hz minimum`,
  );
  assert(gaps.at(-1) <= 50, `${axis} resizing stalled for more than 50 ms`);
  process.stdout.write(
    `${axis} resize frame gaps: p95=${gaps[Math.floor(gaps.length * 0.95)]?.toFixed(1)}ms max=${gaps.at(-1)?.toFixed(1)}ms\n`,
  );
  await page.mouse.up();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-onirigiri-slot="pane"]')].every(
      (pane) => pane.dataset.moving === "false",
    ),
  );
}

async function rowBounds(upperPane, lowerPane) {
  const upper = await upperPane.boundingBox();
  const lower = await lowerPane.boundingBox();
  return {
    upper,
    lower,
    height: lower.y + lower.height - upper.y,
    gap: lower.y - upper.y - upper.height,
  };
}

function assertClose(actual, expected) {
  assert(
    Math.abs(actual - expected) < 2,
    `Resize geometry must track the pointer: expected ${expected}, received ${actual}`,
  );
}

async function verifyFocusGeometry(handle) {
  const error = await handle.evaluate((element) => {
    const pane = element
      .closest("[data-onirigiri-pane-id]")
      .getBoundingClientRect();
    const cursor = element.ownerDocument
      .querySelector("[data-onirigiri-grid-cursor]")
      .getBoundingClientRect();
    return Math.max(
      ...["left", "top", "right", "bottom"].map((edge) =>
        Math.abs(pane[edge] - cursor[edge]),
      ),
    );
  });
  assert(error <= 0.05, `Focus outline trails the resizing pane by ${error}px`);
}

async function focusPane(page, paneId) {
  await page.evaluate(
    (id) => window.__retainedPreview.handle.current.focusPane(id),
    paneId,
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-onirigiri-slot="pane"]')].every(
      (pane) => pane.dataset.moving === "false",
    ),
  );
  await page
    .locator(
      `[data-onirigiri-pane-id="${paneId}"] [data-onirigiri-live="true"]`,
    )
    .waitFor();
}
