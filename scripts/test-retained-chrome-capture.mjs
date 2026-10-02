import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPnpm } from "./lib/process.mjs";
import { picturePixels } from "../tests/browser/picture-pixels.ts";

runPnpm(["install", "--offline", "--frozen-lockfile", "--ignore-scripts"]);
const [
  { expect },
  { launchRetainedPicturePreview },
  { verifyResizeInteractions },
] = await Promise.all([
  import("@playwright/test"),
  import("./preview-retained-capture.mjs"),
  import("./test-picture-interactions.mjs"),
]);

const output = await mkdtemp(join(tmpdir(), "onirigiri-canvas-pictures-"));

await verifyResizeInteractions(output);
process.stdout.write(
  `100-pane width, row and split resizing passed. Evidence: ${output}\n`,
);

for (const dpr of [1, 1.25, 1.5, 2]) {
  const preview = await launchRetainedPicturePreview({
    count: 10,
    dpr,
    contentBudget: 1,
  });
  const { page } = preview;
  try {
    await page.bringToFront();
    await expect(page.getByText(/\d+\/\d+ textures retained/)).toBeVisible();
    const first = page.locator('[data-onirigiri-pane-id="pane-0"]');
    await expect(
      first.locator('[data-onirigiri-slot="pane-content"]'),
    ).toHaveAttribute("data-onirigiri-content-ready", "true");
    const picture = first.locator('[data-onirigiri-slot="pane-picture"]');
    await expect(picture).toHaveCount(1);
    await page.evaluate(() =>
      window.__retainedPreview.handle.current.toggleOverview(),
    );
    await expect(first).toHaveAttribute("data-moving", "false");
    const source = await retainedSource(page);
    await page.evaluate(() =>
      window.__retainedPreview.handle.current.focusPane("pane-9"),
    );
    await page.evaluate(() =>
      window.__retainedPreview.handle.current.toggleOverview(),
    );
    await expect(first.locator("iframe")).toHaveCount(0);
    assert.deepEqual(await retainedSource(page), source);
    await page.evaluate(() =>
      window.__retainedPreview.handle.current.toggleOverview(),
    );
    await page.evaluate(() =>
      window.__retainedPreview.handle.current.focusPane("pane-0"),
    );
    await expect(first).toHaveAttribute("data-moving", "false");
    await expect(picture).toHaveAttribute(
      "data-onirigiri-picture-pixelated",
      "false",
    );
    await expect
      .poll(() => picture.evaluate((canvas) => canvas.width))
      .toBeGreaterThan(1);
    const original = await page.evaluate(
      async (pixels) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${pixels}`)).blob(),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(
          0,
          0,
          bitmap.width,
          bitmap.height,
        ).data;
        let gold = 0,
          teal = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 200 && data[i + 1] > 140 && data[i + 2] < 130) gold++;
          if (data[i] < 20 && data[i + 1] > 40 && data[i + 2] > 60) teal++;
        }
        bitmap.close();
        return {
          gold,
          teal,
          width: canvas.width,
          height: canvas.height,
        };
      },
      await picturePixels(page, picture),
    );
    assert(
      original.gold > 100 && original.teal > 1000,
      "The saved frame must contain the fixture's text and background pixels",
    );
    await expect(picture).toBeVisible();
    assert.equal(
      await page.locator('[data-onirigiri-slot="pane"]').count(),
      10,
    );
    assert.equal(
      await page.locator('[data-onirigiri-slot="pane"][hidden]').count(),
      0,
    );
    await page.screenshot({ path: join(output, `retained-${dpr}.png`) });
    const second = await preview.context.newPage();
    await second.goto(preview.url);
    await expect(
      second.locator('[data-onirigiri-picture-ready="true"]').first(),
    ).toBeVisible();
    await second.close();
    process.stdout.write(
      `Canvas capture and ordinary-tab retention passed at ${dpr}x\n`,
    );
  } finally {
    await preview.close();
  }
}

async function retainedSource(page) {
  return page.evaluate(() => {
    const source = window.__retainedPreview.handle.current
      .getCaptureStatus()
      .pictures.find((picture) => picture.paneId === "pane-0");
    return { revision: source.revision, capture: source.capture };
  });
}
