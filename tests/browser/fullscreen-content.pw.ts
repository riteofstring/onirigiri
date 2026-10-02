import { expect, test, type Locator, type Page } from "@playwright/test";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`fullscreen content at pixel ratio ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test("preserves native fullscreen pixels and untransformed graphics through live transitions", async ({
      page,
    }) => {
      test.setTimeout(45000);
      await page.goto(
        `/@fs${repositoryRoot}tests/browser/native-content-guard.html?grid&count=1&preloadMargin=0`,
      );
      const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
      await pane.evaluate((pane) =>
        pane.style.setProperty("--onirigiri-pane-radius", "0px"),
      );
      const content = pane.locator('[data-onirigiri-slot="pane-content"]');
      const canvas = pane.locator("canvas[layoutsubtree]");
      await expect(canvas).toHaveAttribute(
        "data-onirigiri-native-active",
        "true",
      );
      const original = await installPattern(pane);
      try {
        await pane
          .getByRole("button", { name: "Maximize pane", exact: true })
          .click();
        await expect(pane).toHaveAttribute("data-maximized", "true");
        for (const viewport of [
          { width: 1920, height: 1080 },
          { width: 900, height: 1440 },
        ]) {
          await page.evaluate(() => {
            window.__nativeMotionFixture.setLiveContent(false);
            window.__nativeMotionFixture.setMotionRenderer("pane-1", "dom");
          });
          await page.setViewportSize(viewport);
          await expect(pane).toHaveAttribute("data-moving", "false");
          await expect(canvas).toHaveAttribute(
            "data-onirigiri-native-active",
            "true",
          );
          await expect
            .poll(async () => (await pane.boundingBox())?.width ?? 0)
            .toBeGreaterThan(viewport.width * 0.95);
          await expect
            .poll(async () => (await pane.boundingBox())?.height ?? 0)
            .toBeGreaterThan(viewport.height * 0.9);
          const nativeGeometry = await geometry(pane);
          const nativePixels = await content.screenshot();
          await expectCanvasPixels(page, pane);
          await page.evaluate(() =>
            window.__nativeMotionFixture.setLiveContent(true),
          );
          expect(await geometry(pane)).toEqual(nativeGeometry);
          await page.evaluate(() =>
            window.__nativeMotionFixture.setMotionRenderer("pane-1", "canvas"),
          );
          await expect(canvas).toHaveAttribute(
            "data-onirigiri-native-active",
            "true",
          );
          await expect(
            pane.locator('[data-onirigiri-live="true"]'),
          ).toHaveCount(1);
          expect(await geometry(pane)).toEqual(nativeGeometry);
          await expectCanvasPixels(page, pane);
          await expectSamePixels(
            page,
            nativePixels,
            await content.screenshot(),
          );
          await page.evaluate(() =>
            window.__nativeMotionFixture.handle.current!.toggleOverview(),
          );
          await expect(pane).toHaveAttribute("data-moving", "false");
          await expect(canvas).toHaveAttribute(
            "data-onirigiri-native-active",
            "true",
          );
          await page.evaluate(() =>
            window.__nativeMotionFixture.handle.current!.toggleOverview(),
          );
          await expect(pane).toHaveAttribute("data-moving", "false");
          await page.evaluate(() =>
            window.__nativeMotionFixture.setLiveContent(false),
          );
          expect(await geometry(pane)).toEqual(nativeGeometry);
          await expectCanvasPixels(page, pane);
          await expectSamePixels(
            page,
            nativePixels,
            await content.screenshot(),
          );
          expect(
            await original.evaluate(
              ({ iframe, document, canvas, input }) =>
                iframe.isConnected &&
                iframe.contentDocument === document &&
                document!.querySelector("canvas") === canvas &&
                document!.querySelector("input") === input &&
                input!.value === "Keep fullscreen state",
            ),
          ).toBe(true);
        }
        await pane
          .getByRole("button", { name: "Restore pane", exact: true })
          .click();
        await expect(pane).toHaveAttribute("data-maximized", "false");
      } finally {
        await original.dispose();
      }
    });
  });
}

async function installPattern(pane: Locator) {
  return pane.locator("iframe").evaluateHandle((element) => {
    const iframe = element as HTMLIFrameElement;
    const document = iframe.contentDocument!;
    document.documentElement.style.cssText = "background:white;color:black";
    document.body.style.cssText = "margin:0;font:16px sans-serif";
    document.body.innerHTML = `
      <main style="position:fixed;inset:0;background:#eee">
        <header style="padding:24px;border-bottom:3px solid #123456">Fullscreen geometry</header>
        <input value="Keep fullscreen state" style="position:absolute;left:24px;top:100px;width:240px">
        <div style="position:absolute;inset:24px 24px auto auto;width:48px;height:48px;background:#ff0000"></div>
        <div style="position:absolute;inset:auto 24px 24px auto;width:48px;height:48px;background:#0000ff"></div>
        <div style="position:absolute;left:50%;top:50%;width:160px;height:160px;border-radius:50%;background:#008800;transform:translate(-50%,-50%)"></div>
        <section style="position:absolute;left:24px;bottom:24px;width:220px;height:160px">
          <div style="position:absolute;left:40px;top:30px;width:30px;height:30px;background:#f0f"></div>
          <canvas width="320" height="180" style="display:block;width:160px;height:90px;border:4px solid orange;padding:8px;box-shadow:10px 12px 4px #444"></canvas>
        </section>
      </main>`;
    const context = document.querySelector("canvas")!.getContext("2d")!;
    for (const [index, color] of ["#f00", "#0f0", "#00f", "#ff0"].entries()) {
      context.fillStyle = color;
      context.fillRect((index % 2) * 160, Math.floor(index / 2) * 90, 160, 90);
    }
    return {
      iframe,
      document,
      canvas: document.querySelector("canvas"),
      input: document.querySelector("input"),
    };
  });
}

async function expectCanvasPixels(page: Page, pane: Locator) {
  const bounds = (await pane
    .frameLocator("iframe")
    .locator("canvas")
    .boundingBox())!;
  for (const [x, y, expected] of [
    [32, 22, [255, 0, 0, 255]],
    [152, 22, [0, 255, 0, 255]],
    [32, 92, [0, 0, 255, 255]],
    [152, 92, [255, 255, 0, 255]],
  ] as const) {
    const screenshot = await page.screenshot({
      clip: {
        x: bounds.x + (bounds.width * x) / 184,
        y: bounds.y + (bounds.height * y) / 114,
        width: 1,
        height: 1,
      },
    });
    const pixel = await page.evaluate(async (encoded) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], {
          type: "image/png",
        }),
      );
      const context = new OffscreenCanvas(
        bitmap.width,
        bitmap.height,
      ).getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...context.getImageData(0, 0, 1, 1).data];
    }, screenshot.toString("base64"));
    expect(pixel).toEqual(expected);
  }
}

async function geometry(pane: Locator) {
  return pane.locator("iframe").evaluate((element) => {
    const iframe = element as HTMLIFrameElement;
    return [iframe, ...iframe.contentDocument!.querySelectorAll("body *")].map(
      (node) => {
        const bounds = node.getBoundingClientRect();
        return [bounds.x, bounds.y, bounds.width, bounds.height];
      },
    );
  });
}

async function expectSamePixels(page: Page, expected: Buffer, actual: Buffer) {
  const difference = await page.evaluate(
    async ([left, right]) => {
      const decode = async (encoded: string) => {
        const image = await createImageBitmap(
          new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], {
            type: "image/png",
          }),
        );
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        image.close();
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const reference = await decode(left!);
      const candidate = await decode(right!);
      let total = 0;
      let maximum = 0;
      for (let index = 0; index < reference.data.length; index++) {
        const error = Math.abs(reference.data[index]! - candidate.data[index]!);
        total += error;
        maximum = Math.max(maximum, error);
      }
      return {
        dimensions: [candidate.width, candidate.height],
        expected: [reference.width, reference.height],
        mean: total / reference.data.length,
        maximum,
      };
    },
    [expected.toString("base64"), actual.toString("base64")],
  );
  if (difference.maximum > 8 || difference.mean >= 0.01) {
    await test
      .info()
      .attach("native", { body: expected, contentType: "image/png" });
    await test
      .info()
      .attach("live", { body: actual, contentType: "image/png" });
  }
  expect(difference.dimensions).toEqual(difference.expected);
  expect(difference.maximum).toBeLessThanOrEqual(8);
  expect(difference.mean).toBeLessThan(0.01);
}
