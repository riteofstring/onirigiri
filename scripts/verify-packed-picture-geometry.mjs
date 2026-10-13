import { expect } from "@playwright/test";

export async function verifyPackedPictureGeometry(
  page,
  origin,
  observe = async () => {},
) {
  for (const layout of ["strip", "grid"]) {
    await page.goto(`${origin}/?picture-geometry=${layout}`);
    const pane = page.locator('[data-onirigiri-pane-id="sized-picture"]');
    const content = pane.locator('[data-onirigiri-slot="pane-content"]');
    const picture = pane.locator('[data-onirigiri-slot="pane-picture"]');
    const input = page.getByRole("textbox", {
      name: "Sized picture value",
      includeHidden: true,
    });
    const sibling = page.getByRole("textbox", {
      name: "Retained sibling value",
      includeHidden: true,
    });
    await expect(pane).toHaveAttribute("data-onirigiri-picture-ready", "true");
    await input.fill(`Retained ${layout} input`);
    await sibling.fill(`Retained ${layout} sibling`);
    await page.evaluate(() =>
      window.packedPictureWorkspace.current.focusPane("sized-picture"),
    );
    await expect(pane).toHaveAttribute("data-moving", "false");
    const originals = await page.evaluateHandle(() => ({
      input: document.querySelector('[aria-label="Sized picture value"]'),
      sibling: document.querySelector('[aria-label="Retained sibling value"]'),
      layout: window.packedPictureWorkspace.current.getLayout(),
    }));
    try {
      await page.getByRole("button", { name: "Show sized picture" }).click();
      await expect(picture).toBeVisible();
      await expect(
        pane.locator('[data-onirigiri-slot="pane-live-content"]'),
      ).toHaveAttribute("aria-hidden", "true");
      await expect(
        pane.locator('[data-onirigiri-slot="pane-live-content"]'),
      ).toHaveAttribute("inert", "");
      for (const [width, height] of [
        [160, 110],
        [320, 240],
      ]) {
        await page.evaluate(
          ({ width }) => {
            const handle = window.packedPictureWorkspace.current;
            const pane = document.querySelector(
              '[data-onirigiri-pane-id="sized-picture"]',
            );
            const content = pane.querySelector(
              '[data-onirigiri-slot="pane-content"]',
            );
            const layout = structuredClone(handle.getLayout());
            const column = layout.columns.find((column) =>
              column.cells.some((cell) => cell.paneId === "sized-picture"),
            );
            for (const sibling of layout.columns.filter(
              (candidate) => candidate.slotIndex === column.slotIndex,
            )) {
              sibling.widthSpec = {
                unit: "px",
                value: width + pane.offsetWidth - content.offsetWidth,
              };
            }
            handle.restoreLayout(layout);
          },
          { width },
        );
        await expect(pane).toHaveAttribute("data-moving", "false");
        await expect
          .poll(() => content.evaluate((element) => element.clientWidth))
          .toBe(width);
        await page.evaluate((height) => {
          const handle = window.packedPictureWorkspace.current;
          const pane = document.querySelector(
            '[data-onirigiri-pane-id="sized-picture"]',
          );
          const content = pane.querySelector(
            '[data-onirigiri-slot="pane-content"]',
          );
          const layout = structuredClone(handle.getLayout());
          const column = layout.columns.find((column) =>
            column.cells.some((cell) => cell.paneId === "sized-picture"),
          );
          column.cells.find(
            (cell) => cell.paneId === "sized-picture",
          ).heightPx = height + pane.offsetHeight - content.offsetHeight;
          handle.restoreLayout(layout);
        }, height);
        await expect(pane).toHaveAttribute("data-moving", "false");
        await expect
          .poll(() =>
            content.evaluate((element) => [
              element.clientWidth,
              element.clientHeight,
            ]),
          )
          .toEqual([width, height]);
        await expect
          .poll(() =>
            content.evaluate(async (element) => {
              const rect = () => {
                const { x, y, width, height } = element.getBoundingClientRect();
                return [x, y, width, height];
              };
              const before = rect();
              for (let frame = 0; frame < 2; frame += 1) {
                await new Promise(requestAnimationFrame);
                if (rect().some((value, index) => value !== before[index]))
                  return false;
              }
              return (
                element.closest('[data-onirigiri-slot="pane"]').dataset
                  .moving === "false"
              );
            }),
          )
          .toBe(true);
        await expect(picture).toHaveCSS("width", "240px");
        await expect(picture).toHaveCSS("height", "160px");
        const boxes = await content.evaluate((element) => {
          const content = element.getBoundingClientRect();
          const picture = element
            .querySelector('[data-onirigiri-slot="pane-picture"]')
            .getBoundingClientRect();
          return {
            content: {
              x: content.x,
              y: content.y,
              width: content.width,
              height: content.height,
            },
            picture: {
              x: picture.x,
              y: picture.y,
              width: picture.width,
              height: picture.height,
            },
            overflow: getComputedStyle(element).overflow,
          };
        });
        expect(boxes.picture.x).toBeCloseTo(boxes.content.x, 4);
        expect(boxes.picture.y).toBeCloseTo(boxes.content.y, 4);
        expect(boxes.overflow).toBe("hidden");
        const samples = [
          [boxes.content.x + 24, boxes.content.y + 24],
          ...(width > 240
            ? [
                [boxes.content.x + 200, boxes.content.y + 120],
                [boxes.content.x + 280, boxes.content.y + 200],
              ]
            : [
                [boxes.content.x + width + 3, boxes.content.y + 24],
                [boxes.content.x + 24, boxes.content.y + height + 3],
              ]),
        ];
        const pixels = await screenshotPixels(page, samples);
        expect(pixels[0]).toEqual([19, 83, 137, 255]);
        if (width > 240) {
          expect(pixels[1]).toEqual([231, 173, 41, 255]);
          expect(pixels[2]).toEqual([47, 61, 79, 255]);
        } else {
          expect(pixels[1]).not.toEqual([19, 83, 137, 255]);
          expect(pixels[2]).not.toEqual([19, 83, 137, 255]);
        }
        expect(
          await originals.evaluate(
            ({ input, sibling }) =>
              input ===
                document.querySelector('[aria-label="Sized picture value"]') &&
              sibling ===
                document.querySelector('[aria-label="Retained sibling value"]'),
          ),
        ).toBe(true);
        await expect(input).toHaveValue(`Retained ${layout} input`);
        await expect(sibling).toHaveValue(`Retained ${layout} sibling`);
        await observe({ layout, width, height, boxes, pixels });
      }
      await page.getByRole("button", { name: "Restore live input" }).click();
      await expect(picture).toBeHidden();
      await expect(input).toBeVisible();
      await input.fill(`Edited after ${layout} resize`);
      await expect(input).toHaveValue(`Edited after ${layout} resize`);
      expect(
        await originals.evaluate(
          ({ input, sibling }) =>
            input ===
              document.querySelector('[aria-label="Sized picture value"]') &&
            sibling ===
              document.querySelector('[aria-label="Retained sibling value"]'),
        ),
      ).toBe(true);
    } finally {
      await originals.evaluate(({ layout }) =>
        window.packedPictureWorkspace?.current?.restoreLayout(layout),
      );
      await originals.dispose();
    }
  }
}

async function screenshotPixels(page, points) {
  const screenshot = await page.screenshot({ scale: "css" });
  return page.evaluate(
    async ({ encoded, points }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return points.map(([x, y]) =>
        Array.from(
          context.getImageData(Math.round(x), Math.round(y), 1, 1).data,
        ),
      );
    },
    { encoded: screenshot.toString("base64"), points },
  );
}
