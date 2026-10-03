import { expect, test, type Page } from "@playwright/test";
import { holdPaneFrames } from "./pane-frame-clock";
import { picturePixels } from "./picture-pixels";
import { openCanvas } from "./pane-canvas-fixture";
import { chromeLaunchOptions } from "./chrome-launch";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

test.use({
  launchOptions: chromeLaunchOptions,
});

for (const dpr of [1, 2]) {
  test.describe(`canvas at pixel ratio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test("preserves translucent colors in motion and retained PNG pixels", async ({
      page,
    }) => {
      await openCanvas(page);
      await page.evaluate(() => {
        const fixture = window.__paneCanvasFixture;
        fixture.pane.style.transform = "none";
        const content = document.querySelector<HTMLElement>("#content")!;
        content.style.background = "transparent";
        content.innerHTML =
          '<div style="width:100%;height:100%;background:rgba(200,100,50,0.5)"></div>';
        fixture.live = true;
        fixture.surface.requestPaint();
      });
      await expect(page.locator("#content")).toHaveAttribute(
        "data-onirigiri-live",
        "true",
      );
      const version = await page.evaluate(() => {
        const fixture = window.__paneCanvasFixture;
        fixture.live = false;
        const version = fixture.surface.frameVersion;
        fixture.surface.requestPaint();
        return version;
      });
      await expect
        .poll(() =>
          page.evaluate(() => window.__paneCanvasFixture.surface.frameVersion),
        )
        .toBeGreaterThan(version);
      const pixels = await page.evaluate(async () => {
        const fixture = window.__paneCanvasFixture;
        const displayed = await new Promise<Blob>((resolve) =>
          fixture.canvas.toBlob((blob) => resolve(blob!)),
        );
        const retained = await fixture.surface.capture({
          stage: false,
          signal: AbortSignal.timeout(5000),
          maxRasterBytes: 16 * 1024 * 1024,
          maxEncodedBytes: 8 * 1024 * 1024,
        });
        const pixels = [];
        for (const blob of [displayed, retained.image]) {
          const bitmap = await createImageBitmap(blob);
          const reader = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = reader.getContext("2d")!;
          context.drawImage(bitmap, 0, 0);
          pixels.push([...context.getImageData(20, 20, 1, 1).data]);
          bitmap.close();
        }
        return pixels;
      });
      for (const pixel of pixels) {
        for (const [index, expected] of [200, 100, 50, 128].entries())
          expect(Math.abs(pixel[index]! - expected)).toBeLessThanOrEqual(2);
      }
    });

    test("bounds capture allocation without changing the pane's content size", async ({
      page,
    }) => {
      await openCanvas(page);
      const result = await page.evaluate(async () => {
        const fixture = window.__paneCanvasFixture;
        const request = {
          stage: true,
          signal: AbortSignal.timeout(5000),
          maxRasterBytes: 1,
          maxEncodedBytes: 8 * 1024 * 1024,
        };
        const refused = await fixture.surface.capture(request).then(
          () => false,
          () => true,
        );
        const captured = await fixture.surface.capture({
          ...request,
          maxRasterBytes: 4096,
        });
        const bitmap = await createImageBitmap(captured.image);
        const reader = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = reader.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const result = {
          refused,
          allocation: Math.ceil((bitmap.width * 4) / 256) * 256 * bitmap.height,
          pixel: [...context.getImageData(1, 1, 1, 1).data],
          contentWidth: fixture.iframe.clientWidth,
          staged: fixture.canvas.hasAttribute("popover"),
        };
        bitmap.close();
        return result;
      });
      expect(result.refused).toBe(true);
      expect(result.allocation).toBeLessThanOrEqual(4096);
      expect(result.pixel).toEqual([255, 0, 0, 255]);
      expect(result.contentWidth).toBe(400);
      expect(result.staged).toBe(false);
    });

    test("captures an offscreen GPU pane without displaying pixels or replacing its document", async ({
      page,
    }) => {
      await openCanvas(page);
      const result = await page.evaluate(async () => {
        const fixture = window.__paneCanvasFixture;
        const captured = await fixture.surface.capture({
          stage: true,
          signal: AbortSignal.timeout(5000),
          maxRasterBytes: 16 * 1024 * 1024,
          maxEncodedBytes: 8 * 1024 * 1024,
        });
        const bitmap = await createImageBitmap(captured.image);
        const reader = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = reader.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const pixel = [...context.getImageData(20, 20, 1, 1).data];
        bitmap.close();
        const displayed = await new Promise<Blob>((resolve) =>
          fixture.canvas.toBlob((blob) => resolve(blob!)),
        );
        const displayBitmap = await createImageBitmap(displayed);
        context.clearRect(0, 0, reader.width, reader.height);
        context.drawImage(displayBitmap, 0, 0);
        const displayPixel = [...context.getImageData(20, 20, 1, 1).data];
        displayBitmap.close();
        return {
          pixel,
          displayPixel,
          width: captured.width,
          height: captured.height,
          sameDocument: fixture.iframe.contentDocument === fixture.document,
          value: fixture.document.querySelector("input")!.value,
          focused: document.activeElement === fixture.outside,
          staged: fixture.canvas.hasAttribute("popover"),
          left: fixture.canvas.getBoundingClientRect().left,
          error: fixture.error,
        };
      });
      expect(result).toEqual({
        pixel: [255, 0, 0, 255],
        displayPixel: [0, 0, 0, 0],
        width: 400 * dpr,
        height: 300 * dpr,
        sameDocument: true,
        value: "Keep this edit",
        focused: true,
        staged: false,
        left: -900,
        error: null,
      });
    });

    test("captures deferred document contents before the offscreen pane is visited", async ({
      page,
    }) => {
      await openCanvas(page);
      const result = await page.evaluate(async () => {
        const fixture = window.__paneCanvasFixture;
        fixture.document.body.style.margin = "0";
        fixture.document.body.innerHTML = `
          <section style="content-visibility:auto;contain-intrinsic-size:172px">
            <div style="height:172px;background:rgb(182,40,93)">Deferred list rows</div>
          </section>`;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const captured = await fixture.surface.capture({
          stage: true,
          signal: AbortSignal.timeout(5000),
          maxRasterBytes: 16 * 1024 * 1024,
          maxEncodedBytes: 8 * 1024 * 1024,
        });
        const bitmap = await createImageBitmap(captured.image);
        const reader = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = reader.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const pixel = [
          ...context.getImageData(
            10 * devicePixelRatio,
            180 * devicePixelRatio,
            1,
            1,
          ).data,
        ];
        bitmap.close();
        return {
          pixel,
          sameDocument: fixture.iframe.contentDocument === fixture.document,
          visibility:
            fixture.document.querySelector("section")!.style.contentVisibility,
          focused: document.activeElement === fixture.outside,
          staged: fixture.canvas.hasAttribute("popover"),
          left: fixture.canvas.getBoundingClientRect().left,
        };
      });
      expect(result).toEqual({
        pixel: [182, 40, 93, 255],
        sameDocument: true,
        visibility: "auto",
        focused: true,
        staged: false,
        left: -900,
      });
    });

    test("restores a cancelled capture and keeps live forms interactive through both resize axes", async ({
      page,
    }) => {
      await openCanvas(page);
      const cancelled = await page.evaluate(async () => {
        const fixture = window.__paneCanvasFixture;
        const controller = new AbortController();
        const capture = fixture.surface.capture({
          stage: true,
          signal: controller.signal,
          maxRasterBytes: 16 * 1024 * 1024,
          maxEncodedBytes: 8 * 1024 * 1024,
        });
        controller.abort();
        const rejected = await capture.then(
          () => false,
          () => true,
        );
        return {
          rejected,
          staged: fixture.canvas.hasAttribute("popover"),
          left: fixture.canvas.getBoundingClientRect().left,
        };
      });
      expect(cancelled).toEqual({ rejected: true, staged: false, left: -900 });
      await page.evaluate(() => {
        const fixture = window.__paneCanvasFixture;
        fixture.pane.style.transform = "translate(0, 0)";
        fixture.live = true;
        fixture.surface.requestPaint();
      });
      await expect
        .poll(() => page.evaluate(() => window.__paneCanvasFixture.drawn))
        .toBe(true);
      for (const [width, height] of [
        [600, 450],
        [300, 260],
      ]) {
        await page.evaluate(
          ({ width, height }) => {
            const fixture = window.__paneCanvasFixture;
            fixture.pane.style.width = `${width}px`;
            fixture.pane.style.height = `${height}px`;
          },
          { width, height },
        );
        await expect
          .poll(() =>
            page.evaluate(() => {
              const frame = window.__paneCanvasFixture.iframe;
              return [
                frame.parentElement!.offsetWidth,
                frame.parentElement!.offsetHeight,
              ];
            }),
          )
          .toEqual([width, height]);
        await page
          .frameLocator("iframe")
          .getByRole("textbox")
          .fill(`${width} by ${height}`);
        await expect(
          page.frameLocator("iframe").getByRole("textbox"),
        ).toHaveValue(`${width} by ${height}`);
      }
      expect(
        await page.evaluate(() => window.__paneCanvasFixture.error),
      ).toBeNull();
    });
  });
}

test("engine captures the next pane before navigation and fills cold overview pictures", async ({
  page,
}) => {
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?count=20&overviewPictures`,
  );
  await page.bringToFront();
  const first = page.locator('[data-onirigiri-pane-id="pane-1"]');
  await expect(
    first.locator('[data-onirigiri-slot="pane-content"]'),
  ).toHaveAttribute("data-onirigiri-content-ready", "true");
  const neighbor = page.locator('[data-onirigiri-pane-id="pane-3"]');
  await expect(
    neighbor.locator('[data-onirigiri-slot="pane-picture"]'),
  ).toHaveCount(1);
  expect(
    await neighbor.evaluate((element) => element.getBoundingClientRect().left),
  ).toBeGreaterThan(await page.evaluate(() => innerWidth));
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect
    .poll(() =>
      neighbor
        .locator('[data-onirigiri-slot="pane-picture"]')
        .evaluate((element) => (element as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(1);
  const snapshot = await page.evaluate(
    async (base64) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${base64}`)).blob(),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const pixel = [...context.getImageData(3, 3, 1, 1).data];
      bitmap.close();
      return pixel;
    },
    await picturePixels(
      page,
      neighbor.locator('[data-onirigiri-slot="pane-picture"]'),
    ),
  );
  expect(snapshot).toEqual([8, 59, 75, 255]);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.focusPane("pane-3"),
  );
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect(
    neighbor.locator('[data-onirigiri-slot="pane-content"]'),
  ).toHaveAttribute("data-onirigiri-content-ready", "true");
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect
    .poll(async () =>
      page.locator('[data-onirigiri-slot="pane-picture"]').count(),
    )
    .toBeGreaterThan(4);
  expect(
    await page.locator('[data-onirigiri-overview-capture="true"]').count(),
  ).toBeLessThanOrEqual(1);
});

test("preserves resized live pixels while a background capture is encoding", async ({
  page,
}) => {
  for (const renderer of ["dom", "canvas"] as const) {
    await openCanvas(page);
    await page.evaluate((renderer) => {
      const fixture = window.__paneCanvasFixture;
      const content = document.querySelector<HTMLElement>("#content")!;
      content.replaceChildren();
      content.style.position = "relative";
      const marker = document.createElement("div");
      marker.style.cssText =
        "position:absolute;left:40px;top:30px;width:80px;height:40px;background:red";
      content.append(marker);
      fixture.pane.style.transform = "none";
      fixture.motionRenderer = renderer;
      fixture.live = true;
      fixture.surface.requestPaint();
    }, renderer);
    await expect(page.locator("#content")).toHaveAttribute(
      "data-onirigiri-live",
      "true",
    );
    await page.evaluate(() => {
      const pane = window.__paneCanvasFixture.pane;
      pane.style.width = "700px";
      pane.style.height = "260px";
    });
    const expected = { x: 40, y: 30, width: 80, height: 40 };
    await expect.poll(() => redPixelBounds(page)).toEqual(expected);
    const capture = await page.evaluateHandle(() => {
      const post = Worker.prototype.postMessage;
      let release!: () => void;
      let encoding!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const started = new Promise<void>((resolve) => (encoding = resolve));
      Worker.prototype.postMessage = function (
        this: Worker,
        ...message: Parameters<Worker["postMessage"]>
      ) {
        encoding();
        void gate.then(() => post.apply(this, message));
      } as Worker["postMessage"];
      const completion = window.__paneCanvasFixture.surface
        .capture({
          stage: false,
          signal: AbortSignal.timeout(10000),
          maxRasterBytes: 16 * 1024 * 1024,
          maxEncodedBytes: 8 * 1024 * 1024,
        })
        .finally(() => (Worker.prototype.postMessage = post));
      return { started, completion, release };
    });
    try {
      await capture.evaluate((capture) => capture.started);
      expect(await redPixelBounds(page)).toEqual(expected);
    } finally {
      await capture.evaluate(async (capture) => {
        capture.release();
        await capture.completion;
      });
      await capture.dispose();
    }
    await expect.poll(() => redPixelBounds(page)).toEqual(expected);
  }
});

for (const axis of ["width", "height"] as const) {
  test(`held ${axis} resizing crops the original top-aligned pixels without scaling`, async ({
    page,
  }) => {
    await openCanvas(page);
    await page.addStyleTag({ url: `/@fs${repositoryRoot}src/styles.css` });
    await page.evaluate(() => {
      const fixture = window.__paneCanvasFixture;
      fixture.canvas.className = "onirigiri-pane__live-surface";
      fixture.pane.style.transform = "none";
      fixture.live = true;
      fixture.surface.requestPaint();
    });
    await expect
      .poll(() => page.evaluate(() => window.__paneCanvasFixture.drawn))
      .toBe(true);
    await page.evaluate(() => {
      const fixture = window.__paneCanvasFixture;
      fixture.surface.setResizing(true);
      fixture.live = false;
    });
    const original = await redPixelBounds(page);
    expect(original.width).toBeGreaterThan(0);
    expect(original.height).toBeGreaterThan(0);
    for (const extent of axis === "width" ? [800, 100] : [600, 32]) {
      await page.evaluate(
        ({ axis, extent }) => {
          window.__paneCanvasFixture.pane.style[axis] = `${extent}px`;
        },
        { axis, extent },
      );
      const redBounds = await redPixelBounds(page);
      expect(redBounds).toEqual({
        x: 0,
        y: 0,
        width:
          axis === "width" ? Math.min(original.width, extent) : original.width,
        height:
          axis === "height"
            ? Math.min(original.height, extent)
            : original.height,
      });
    }
    await page.evaluate(() => {
      const fixture = window.__paneCanvasFixture;
      fixture.surface.setResizing(false);
      fixture.live = true;
      fixture.surface.requestPaint();
    });
    await page
      .frameLocator("iframe")
      .getByRole("textbox")
      .fill("Still editable after resize");
  });
}

test("layout and revision changes invalidate the recorded frame", async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.pane.style.transform = "none";
    fixture.motionRenderer = "canvas";
    fixture.live = true;
    fixture.surface.requestPaint();
  });
  await expect(page.locator("#content")).toHaveAttribute(
    "data-onirigiri-live",
    "true",
  );
  const initial = await page.evaluate(() =>
    window.__paneCanvasFixture.surface.hasCurrentFrame(),
  );
  expect(initial).toBe(true);
  expect(
    await page.evaluate(() => {
      window.__paneCanvasFixture.revision++;
      return window.__paneCanvasFixture.surface.hasCurrentFrame();
    }),
  ).toBe(false);
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.pane.style.width = "500px";
    fixture.live = false;
    fixture.surface.requestPaint();
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__paneCanvasFixture.surface.hasCurrentFrame()),
    )
    .toBe(true);
  const picture = await page.evaluate(async () => {
    const fixture = window.__paneCanvasFixture;
    const result = await fixture.surface.capture({
      signal: new AbortController().signal,
      stage: false,
      maxRasterBytes: 128 * 1024 * 1024,
      maxEncodedBytes: 32 * 1024 * 1024,
    });
    return { width: result.width, expected: 500 * devicePixelRatio };
  });
  expect(picture.width).toBe(picture.expected);
});

test("keeps the previous pixels while a resized recording corrects its density", async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    const content = document.querySelector<HTMLElement>("#content")!;
    content.innerHTML = "";
    content.style.background = "rgb(220, 30, 50)";
    fixture.pane.style.transform = "none";
    fixture.live = true;
    fixture.motionRenderer = "canvas";
    fixture.surface.requestPaint();
  });
  await expect(page.locator("#content")).toHaveAttribute(
    "data-onirigiri-live",
    "true",
  );
  const before = await page.screenshot({
    clip: { x: 100, y: 100, width: 1, height: 1 },
  });
  const pending = await page.evaluateHandle(() => {
    const fixture = window.__paneCanvasFixture;
    const canvas = fixture.canvas as HTMLCanvasElement & {
      captureElementImage(element: Element): { width: number; close(): void };
    };
    const capture = canvas.captureElementImage;
    const state = { deferred: false };
    const hold = (event: Event) => {
      if (state.deferred) event.stopImmediatePropagation();
    };
    canvas.addEventListener("paint", hold, true);
    canvas.captureElementImage = function (element) {
      const image = capture.call(this, element);
      state.deferred = true;
      return { width: image.width * 2, close: () => image.close() };
    };
    fixture.pane.style.width = "800px";
    fixture.surface.requestPaint();
    return {
      state,
      release() {
        canvas.captureElementImage = capture;
        canvas.removeEventListener("paint", hold, true);
        fixture.surface.requestPaint();
      },
    };
  });
  try {
    await expect
      .poll(() => pending.evaluate(({ state }) => state.deferred))
      .toBe(true);
    const during = await page.screenshot({
      clip: { x: 100, y: 100, width: 1, height: 1 },
    });
    expect(during.equals(before)).toBe(true);
  } finally {
    await pending.evaluate((pending) => pending.release());
    await pending.dispose();
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fixture = window.__paneCanvasFixture;
        return (
          fixture.canvas.width === 800 * devicePixelRatio &&
          fixture.surface.hasCurrentFrame()
        );
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => window.__paneCanvasFixture.error),
  ).toBeNull();
});

for (const missing of ["HTML-in-Canvas", "WebGPU"] as const) {
  test(`keeps panes usable with native content without ${missing}`, async ({
    page,
  }) => {
    await page.addInitScript((missing) => {
      if (missing === "WebGPU")
        Object.defineProperty(navigator, "gpu", { value: undefined });
      else
        Object.defineProperty(
          HTMLCanvasElement.prototype,
          "captureElementImage",
          { value: undefined },
        );
    }, missing);
    await page.goto(
      `/@fs${repositoryRoot}tests/browser/native-content-guard.html?count=5`,
    );
    await expect(page.locator('[data-onirigiri-slot="pane"]')).toHaveCount(5);
    const first = page.locator('[data-onirigiri-pane-id="pane-1"]');
    await expect(first).toHaveAttribute("data-onirigiri-renderer", "dom");
    await expect(
      first.frameLocator("iframe").getByRole("heading"),
    ).toBeVisible();
    expect(
      await first
        .locator('[data-onirigiri-slot="pane-live-content"]')
        .evaluate((content) => content.closest("canvas") === null),
    ).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__nativeMotionFixture.handle.current!.getCaptureStatus()
              .state,
        ),
      )
      .toBe("unavailable");
    expect(
      await page.evaluate(
        () =>
          window.__nativeMotionFixture.handle.current!.getCaptureStatus()
            .reason,
      ),
    ).toContain("HTML-in-Canvas");
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-3"),
    );
    const third = page.locator('[data-onirigiri-pane-id="pane-3"]');
    await expect(third).toHaveAttribute("data-focused", "true");
    await expect(third).toHaveAttribute("data-moving", "false");
    await expect(third).toHaveAttribute("data-onirigiri-renderer", "dom");
    await expect(
      third.frameLocator("iframe").getByRole("heading"),
    ).toBeVisible();
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.toggleOverview(),
    );
    await expect(third).toHaveAttribute("data-moving", "false");
    await third.click();
    await expect(third).toHaveAttribute("data-presentation-mode", "normal");
  });
}

test("normal activation starts with focus and proceeds outward on separate frames", async ({
  page,
}) => {
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?count=12&preloadMargin=0`,
  );
  await expect(
    page.locator(
      '[data-onirigiri-pane-id="pane-1"] [data-onirigiri-content-ready="true"]',
    ),
  ).toHaveCount(1);
  await page.evaluate(() => {
    window.__nativeMotionFixture.activations.length = 0;
    window.__nativeMotionFixture.handle.current!.focusPane("pane-7");
  });
  await expect(
    page.locator(
      '[data-onirigiri-pane-id="pane-7"] [data-onirigiri-content-ready="true"]',
    ),
  ).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Set(window.__nativeMotionFixture.activations.map(({ id }) => id))
            .size,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  const activations = await page.evaluate(() =>
    [
      ...new Map(
        window.__nativeMotionFixture.activations
          .toReversed()
          .map((entry) => [entry.id, entry]),
      ).values(),
    ].sort((a, b) => a.time - b.time),
  );
  expect(activations[0]!.id).toBe("pane-7");
  expect(activations[1]!.time - activations[0]!.time).toBeGreaterThan(1);
});

test("cached previews cover panes revealed by repeated two-dimensional navigation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?grid&count=100&pictures&allPictures`,
  );
  await expect(
    page.locator('[data-onirigiri-picture-ready="true"]'),
  ).toHaveCount(100, { timeout: 60_000 });
  const clock = await holdPaneFrames(page);
  try {
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-16"),
    );
    for (let frame = 0; frame < 8; frame++)
      await clock.evaluate((clock) => clock.step());
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-26"),
    );
    for (let frame = 0; frame < 24; frame++) {
      await clock.evaluate((clock) => clock.step());
      const missing = await page
        .locator('[data-onirigiri-content-ready="false"]')
        .evaluateAll((contents) =>
          contents.flatMap((content) => {
            const bounds = content.getBoundingClientRect();
            if (
              bounds.right <= 0 ||
              bounds.left >= innerWidth ||
              bounds.bottom <= 0 ||
              bounds.top >= innerHeight
            )
              return [];
            const picture = content.querySelector<HTMLCanvasElement>(
              '[data-onirigiri-slot="pane-picture"]',
            );
            return picture && picture.width > 1 && picture.height > 1
              ? []
              : [
                  content
                    .closest("[data-onirigiri-pane-id]")!
                    .getAttribute("data-onirigiri-pane-id"),
                ];
          }),
        );
      expect(missing).toEqual([]);
    }
    const entering = page.locator('[data-onirigiri-pane-id="pane-36"]');
    expect((await entering.boundingBox())!.y).toBeLessThan(1000);
    await expect(entering).toHaveAttribute("data-moving", "true");
  } finally {
    await clock.evaluate((clock) => clock.release());
    await clock.dispose();
  }
});

test("reduced captures preserve the full content rectangle without letterboxing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?grid&count=4&pictures&allPictures&rasterBudget=250000`,
  );
  await expect(
    page.locator('[data-onirigiri-picture-ready="true"]'),
  ).toHaveCount(4);
  const clock = await holdPaneFrames(page);
  try {
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-3"),
    );
    const pane = page.locator('[data-onirigiri-pane-id="pane-4"]');
    for (let frame = 0; frame < 90; frame++) {
      await clock.evaluate((clock) => clock.step());
      const visible = await pane.evaluate((pane) => {
        const bounds = pane.getBoundingClientRect();
        return bounds.x >= 0 && bounds.right <= innerWidth;
      });
      if (visible) break;
    }
    await expect(pane).toHaveAttribute("data-moving", "true");
    await expect(
      pane.locator('[data-onirigiri-picture-visible="true"]'),
    ).toHaveCount(1);
    await expect(
      pane.locator('[data-onirigiri-slot="pane-picture"]'),
    ).toHaveAttribute("data-onirigiri-picture-pixelated", "true");
    const bounds = (await pane
      .locator('[data-onirigiri-slot="pane-content"]')
      .boundingBox())!;
    const pixels: number[][] = [];
    for (const x of [
      bounds.x + bounds.width / 2,
      bounds.x + 1,
      bounds.x + bounds.width - 2,
    ]) {
      const screenshot = await page.screenshot({
        clip: { x, y: bounds.y + bounds.height / 2, width: 1, height: 1 },
      });
      const pixel = await page.evaluate(async (encoded) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
        );
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0, 1, 1);
        bitmap.close();
        return [...context.getImageData(0, 0, 1, 1).data];
      }, screenshot.toString("base64"));
      pixels.push(pixel);
    }
    for (const pixel of pixels) {
      expect(pixel[2]! - pixel[0]!).toBeGreaterThan(30);
      expect(pixel[1]! - pixel[0]!).toBeGreaterThan(20);
      expect(pixel[3]).toBe(255);
    }
  } finally {
    await clock.evaluate((clock) => clock.release());
    await clock.dispose();
  }
});

test("always-live mode preserves animated pixels and documents through motion and overview", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?grid&count=12&cooperative&overviewWidth=180`,
  );
  const panes = page.locator('[data-onirigiri-slot="pane"]');
  const pane = page.locator('[data-onirigiri-pane-id="pane-2"]');
  const canvas = pane.locator("canvas[layoutsubtree]");
  await expect(canvas).toHaveAttribute("data-onirigiri-native-active", "true");
  expect(await panes.locator("iframe").count()).toBeLessThan(12);
  await page.evaluate(() => window.__nativeMotionFixture.setLiveContent(true));
  await expect(panes.locator('iframe[data-consumer-ready="true"]')).toHaveCount(
    12,
  );
  const original = await pane.locator("iframe").evaluateHandle((frame) => {
    const iframe = frame as HTMLIFrameElement;
    iframe.contentDocument!.querySelector("input")!.value = "Preserved edit";
    return { iframe, document: iframe.contentDocument };
  });
  const clock = await holdPaneFrames(page);
  try {
    const hiddenRenders = await page.evaluate(
      () => window.__nativeMotionFixture.renders["pane-10"],
    );
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-2"),
    );
    for (let index = 0; index < 8; index++)
      await clock.evaluate((clock) => clock.step());
    await expect(pane).toHaveAttribute("data-moving", "true");
    await expect(canvas).not.toHaveAttribute(
      "data-onirigiri-native-active",
      "true",
    );
    await expect(
      pane.locator('[data-onirigiri-slot="pane-content"]'),
    ).toHaveAttribute("data-runtime-state", "live");
    await expect(
      pane.locator('[data-onirigiri-slot="pane-live-content"]'),
    ).toHaveAttribute("inert", "");
    await expectLiveColors(page, "pane-2");
    expect(
      await page.evaluate(
        () => window.__nativeMotionFixture.renders["pane-10"],
      ),
    ).toBe(hiddenRenders);
  } finally {
    await clock.evaluate((clock) => clock.release());
    await clock.dispose();
  }
  await expect(pane).toHaveAttribute("data-moving", "false");
  await expect(canvas).toHaveAttribute("data-onirigiri-native-active", "true");
  await page.evaluate(() =>
    window.__nativeMotionFixture.setMotionRenderer("pane-3", "canvas"),
  );
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect(pane).toHaveAttribute("data-moving", "false");
  await expect(pane).toHaveAttribute("data-presentation-mode", "overview");
  await expect(canvas).toHaveAttribute("data-onirigiri-native-active", "true");
  await expectLiveColors(page, "pane-2");
  const ticks = () =>
    pane
      .locator("iframe")
      .evaluate(
        (frame) =>
          (
            (frame as HTMLIFrameElement).contentWindow as Window &
              typeof globalThis
          ).__nativeContentWork.snapshot().ticks,
      );
  const before = await ticks();
  await expect.poll(ticks).toBeGreaterThan(before + 2);
  const overviewBounds = await pane.locator("iframe").boundingBox();
  expect(overviewBounds!.width).toBeGreaterThan(0);
  const exitClock = await holdPaneFrames(page);
  try {
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.toggleOverview(),
    );
    await expect(pane).toHaveAttribute("data-presentation-mode", "normal");
    await expectLiveColors(page, "pane-2");
    expect(await pane.locator("iframe").boundingBox()).toEqual(overviewBounds);
  } finally {
    await exitClock.evaluate((clock) => clock.release());
    await exitClock.dispose();
  }
  await expect(canvas).toHaveAttribute("data-onirigiri-native-active", "true");
  await expect(
    page.locator('[data-onirigiri-pane-id="pane-3"] canvas[layoutsubtree]'),
  ).toHaveAttribute("data-onirigiri-native-active", "true");
  expect(
    await original.evaluate(
      ({ iframe, document }) =>
        iframe.isConnected &&
        iframe.contentDocument === document &&
        document!.querySelector("input")!.value === "Preserved edit",
    ),
  ).toBe(true);
  await original.dispose();
  await page.evaluate(() => window.__nativeMotionFixture.setLiveContent(false));
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect(pane).toHaveAttribute("data-moving", "false");
  await expect(
    pane.locator('[data-onirigiri-slot="pane-content"]'),
  ).toHaveAttribute("data-runtime-state", "frozen");
});

test("live motion adapts to graphics inserted into an existing iframe without replacing content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?grid&count=2&liveContent`,
  );
  const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
  await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
  const original = await pane.locator("iframe").evaluateHandle((element) => {
    const iframe = element as HTMLIFrameElement;
    const document = iframe.contentDocument!;
    const input = document.querySelector("input")!;
    input.value = "Preserve graphics state";
    return { iframe, document, input };
  });
  const clock = await holdPaneFrames(page);
  try {
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.toggleOverview(),
    );
    for (let index = 0; index < 6; index++)
      await clock.evaluate((clock) => clock.step());
    await expect(pane).toHaveAttribute("data-onirigiri-renderer", "canvas");
    const graphics = await original.evaluateHandle(({ document }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      canvas.style.cssText =
        "position:absolute;left:40px;top:60px;width:160px;height:90px;border:4px solid orange;padding:8px";
      const context = canvas.getContext("2d")!;
      context.fillStyle = "rgb(20,180,90)";
      context.fillRect(0, 0, 320, 180);
      document.body.append(canvas);
      return canvas;
    });
    await clock.evaluate((clock) => clock.step());
    await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
    const color = await graphics.evaluate((canvas) => [
      ...canvas.getContext("2d")!.getImageData(120, 60, 1, 1).data,
    ]);
    expect(color).toEqual([20, 180, 90, 255]);
    await expectLiveColors(page, "pane-1");
    await graphics.evaluate((canvas) => canvas.remove());
    await graphics.dispose();
    await expect(pane).toHaveAttribute("data-onirigiri-renderer", "canvas");
    expect(
      await original.evaluate(
        ({ iframe, document, input }) =>
          iframe.contentDocument === document &&
          document.querySelector("input") === input &&
          input.value === "Preserve graphics state",
      ),
    ).toBe(true);
  } finally {
    await clock.evaluate((clock) => clock.release());
    await clock.dispose();
    await original.dispose();
  }
  await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
});

async function expectLiveColors(page: Page, paneId: string): Promise<void> {
  const pane = page.locator(`[data-onirigiri-pane-id="${paneId}"]`);
  for (const color of ["rgb(200, 40, 60)", "rgb(30, 80, 210)"]) {
    await pane.locator("iframe").evaluate((frame, color) => {
      (
        frame as HTMLIFrameElement
      ).contentDocument!.documentElement.style.backgroundColor = color;
    }, color);
    await expect
      .poll(async () => {
        const bounds = (await pane
          .locator('[data-onirigiri-slot="pane-content"]')
          .boundingBox())!;
        const screenshot = await page.screenshot({
          clip: {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height * 0.8,
            width: 1,
            height: 1,
          },
        });
        return page.evaluate(async (encoded) => {
          const bitmap = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
          );
          const context = new OffscreenCanvas(1, 1).getContext("2d")!;
          context.drawImage(bitmap, 0, 0, 1, 1);
          bitmap.close();
          return [...context.getImageData(0, 0, 1, 1).data];
        }, screenshot.toString("base64"));
      })
      .toEqual(
        color.startsWith("rgb(200") ? [200, 40, 60, 255] : [30, 80, 210, 255],
      );
  }
}

test("background caching fills every pane serially beyond the retained DOM budget", async ({
  page,
}) => {
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?count=12&pictures&allPictures`,
  );
  await page.evaluate(() => {
    window.__paneWarmupMaximum = 0;
    const observe = () => {
      window.__paneWarmupMaximum = Math.max(
        window.__paneWarmupMaximum,
        document.querySelectorAll('[data-onirigiri-preloading="true"]').length,
      );
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
    });
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__nativeMotionFixture.handle.current!.getCaptureStatus()
              .pictures.length,
        ),
      { timeout: 15000 },
    )
    .toBe(12);
  await expect(page.locator('[data-onirigiri-preloading="true"]')).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => window.__paneWarmupMaximum)).toBe(1);
  const far = page.locator('[data-onirigiri-pane-id="pane-12"]');
  await expect(far.locator("iframe")).toHaveCount(0);
  await expect(far.locator('[data-onirigiri-slot="pane-picture"]')).toHaveCount(
    1,
  );
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect(
    page.locator('canvas[data-onirigiri-slot="pane-picture"]'),
  ).toHaveCount(12);
  expect(
    await page.evaluate(
      () =>
        window.__nativeMotionFixture.handle.current!.getSnapshot()
          .focusedPaneId,
    ),
  ).toBe("pane-1");
});

test.describe("live detail at Retina resolution", () => {
  test.use({ deviceScaleFactor: 2 });
  test("refreshes offscreen texture dimensions after navigation and viewport resizing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(
      `/@fs${repositoryRoot}tests/browser/native-content-guard.html?count=12&pictures&allPictures`,
    );
    await expect(
      page.locator('[data-onirigiri-native-active="true"]').first(),
    ).toBeAttached();
    await page.evaluate(() => {
      window.__nativeMotionFixture.setMotionRenderer("pane-7", "canvas");
      window.__nativeMotionFixture.handle.current!.focusPane("pane-7");
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__nativeMotionFixture.handle.current!.getCaptureStatus()
                .pictures.length,
          ),
        { timeout: 15000 },
      )
      .toBe(12);
    const far = page.locator('[data-onirigiri-pane-id="pane-1"]');
    await expect(far.locator("iframe")).toHaveCount(0);
    const before = await page.evaluate(
      () =>
        window.__nativeMotionFixture.handle
          .current!.getCaptureStatus()
          .pictures.find(({ paneId }) => paneId === "pane-1")!.capture,
    );
    await page.setViewportSize({ width: 1280, height: 640 });
    await expect
      .poll(() =>
        far
          .locator('[data-onirigiri-slot="pane-live-content"]')
          .evaluate((content) => (content as HTMLElement).offsetHeight),
      )
      .not.toBe(before!.bounds.height);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.__nativeMotionFixture.handle
              .current!.getCaptureStatus()
              .pictures.filter(({ paneId, capture }) => {
                const content = document.querySelector<HTMLElement>(
                  `[data-onirigiri-pane-id="${paneId}"] [data-onirigiri-slot="pane-live-content"]`,
                )!;
                return (
                  capture?.bounds.width !== content.offsetWidth ||
                  capture.bounds.height !== content.offsetHeight
                );
              })
              .map(({ paneId }) => paneId),
          ),
        { timeout: 15000 },
      )
      .toEqual([]);
    const after = await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.getCaptureStatus(),
    );
    expect(after.pictures).toHaveLength(12);
    expect(
      after.pictures.find(({ paneId }) => paneId === "pane-1")!.capture!.id,
    ).not.toBe(before!.id);
    await expect(far.locator("iframe")).toHaveCount(0);
  });

  test("renders changing original DOM at rest without canvas copies", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__paneCanvasCopies = 0;
      const queue = (
        window as unknown as {
          GPUQueue: {
            prototype: {
              copyElementImageToTexture: (...args: unknown[]) => unknown;
            };
          };
        }
      ).GPUQueue.prototype;
      const copy = queue.copyElementImageToTexture;
      queue.copyElementImageToTexture = function (...args) {
        window.__paneCanvasCopies++;
        return copy.apply(this, args);
      };
    });
    await page.goto(
      `/@fs${repositoryRoot}tests/browser/native-content-guard.html?count=5&preloadMargin=0`,
    );
    const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
    await expect(pane.locator('[data-onirigiri-live="true"]')).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__nativeMotionFixture.handle.current!.getCaptureStatus()
              .inFlightPaneIds.length,
        ),
      )
      .toBe(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const retained = new Set(
            window.__nativeMotionFixture.handle
              .current!.getCaptureStatus()
              .pictures.map((picture) => picture.paneId),
          );
          return [
            ...document.querySelectorAll<HTMLElement>(
              '[data-onirigiri-slot="pane"][data-visible="true"]',
            ),
          ].every((pane) => retained.has(pane.dataset.onirigiriPaneId!));
        }),
      )
      .toBe(true);
    await expect(pane.locator("canvas[layoutsubtree]")).toHaveAttribute(
      "data-onirigiri-native-active",
      "true",
    );
    expect(
      await pane
        .locator('[data-onirigiri-slot="pane-live-content"]')
        .evaluate((content) => content.closest("canvas") === null),
    ).toBe(true);
    await page.waitForTimeout(300);
    const copies = await page.evaluate(() => window.__paneCanvasCopies);
    const accepted = await page.evaluate(
      () =>
        window.__nativeMotionFixture.handle.current!.getCaptureStatus()
          .accepted,
    );
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__paneCanvasCopies)).toBe(copies);
    const frame = await (await pane
      .locator("iframe")
      .elementHandle())!.contentFrame();
    const origin = await frame!.evaluate(() => {
      document.documentElement.style.background = "rgb(20, 180, 90)";
      return performance.timeOrigin;
    });
    await frame!.getByRole("textbox").fill("Native editing at full detail");
    await page.waitForTimeout(500);
    const screenshot = await pane
      .locator('[data-onirigiri-slot="pane-content"]')
      .screenshot();
    const pixel = await page.evaluate(async (encoded) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], {
          type: "image/png",
        }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const pixel = [...context.getImageData(5, 5, 1, 1).data];
      bitmap.close();
      return pixel;
    }, screenshot.toString("base64"));
    expect(pixel).toEqual([20, 180, 90, 255]);
    expect(await page.evaluate(() => window.__paneCanvasCopies)).toBe(copies);
    expect(
      await page.evaluate(
        () =>
          window.__nativeMotionFixture.handle.current!.getCaptureStatus()
            .accepted,
      ),
    ).toBe(accepted);
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.toggleOverview(),
    );
    await expect(pane.locator('[data-onirigiri-live="true"]')).toHaveCount(0);
    expect(
      await pane
        .locator('[data-onirigiri-slot="pane-live-content"]')
        .evaluate((content) => content.closest("canvas") === null),
    ).toBe(true);
    expect(await page.evaluate(() => window.__paneCanvasCopies)).toBe(copies);
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.toggleOverview(),
    );
    await expect(pane.locator('[data-onirigiri-live="true"]')).toHaveCount(1);
    expect(
      await pane
        .locator('[data-onirigiri-slot="pane-live-content"]')
        .evaluate((content) => content.closest("canvas") === null),
    ).toBe(true);
    expect(await frame!.evaluate(() => performance.timeOrigin)).toBe(origin);
    await expect(frame!.getByRole("textbox")).toHaveValue(
      "Native editing at full detail",
    );
  });

  test("selects individual motion renderers and restores native rest while preserving live pixels and document state", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(
      `/@fs${repositoryRoot}tests/browser/native-content-guard.html?count=2&preloadMargin=0&liveContent`,
    );
    const panes = page.locator('[data-onirigiri-slot="pane-live-content"]');
    const renderers = () =>
      panes.evaluateAll((contents) =>
        contents.map((content) =>
          content.closest("canvas") ? "canvas" : "dom",
        ),
      );
    await expect.poll(renderers).toEqual(["dom", "dom"]);
    const frames = await Promise.all(
      (await page.locator("iframe").elementHandles()).map((frame) =>
        frame.contentFrame(),
      ),
    );
    const origins = await Promise.all(
      frames.map((frame) => frame!.evaluate(() => performance.timeOrigin)),
    );
    await frames[1]!.getByRole("textbox").fill("Keep this document");
    const bounds = await panes.evaluateAll((contents) =>
      contents.map((content) => content.getBoundingClientRect().toJSON()),
    );
    await page.evaluate(() =>
      window.__nativeMotionFixture.setMotionRenderer("pane-2", "canvas"),
    );
    await expect.poll(renderers).toEqual(["dom", "dom"]);
    for (const [index, color] of [
      "rgb(20, 180, 90)",
      "rgb(190, 60, 120)",
    ].entries()) {
      await frames[index]!.evaluate((color) => {
        document.documentElement.style.background = color;
      }, color);
      await expect
        .poll(async () => {
          const screenshot = await page
            .locator('[data-onirigiri-slot="pane-content"]')
            .nth(index)
            .screenshot();
          return page.evaluate(async (encoded) => {
            const bitmap = await createImageBitmap(
              new Blob([
                Uint8Array.from(atob(encoded), (character) =>
                  character.charCodeAt(0),
                ),
              ]),
            );
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(bitmap, 0, 0);
            const pixel = [...context.getImageData(200, 40, 1, 1).data];
            bitmap.close();
            return pixel;
          }, screenshot.toString("base64"));
        })
        .toEqual(index === 0 ? [20, 180, 90, 255] : [190, 60, 120, 255]);
    }
    await frames[1]!.getByRole("textbox").fill("Edited native content");
    await page.evaluate(() => {
      window.__nativeMotionFixture.setMotionRenderer("pane-1", "canvas");
      window.__nativeMotionFixture.setMotionRenderer("pane-2", "dom");
    });
    await expect.poll(renderers).toEqual(["dom", "dom"]);
    const clock = await holdPaneFrames(page);
    try {
      await page.evaluate(() =>
        window.__nativeMotionFixture.handle.current!.toggleOverview(),
      );
      for (let index = 0; index < 8; index++)
        await clock.evaluate((clock) => clock.step());
      await expect.poll(renderers).toEqual(["canvas", "dom"]);
      await expectLiveColors(page, "pane-1");
      await expectLiveColors(page, "pane-2");
    } finally {
      await clock.evaluate((clock) => clock.release());
      await clock.dispose();
    }
    await expect.poll(renderers).toEqual(["dom", "dom"]);
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.toggleOverview(),
    );
    await expect.poll(renderers).toEqual(["dom", "dom"]);
    expect(
      await Promise.all(
        frames.map((frame) => frame!.evaluate(() => performance.timeOrigin)),
      ),
    ).toEqual(origins);
    await expect(frames[1]!.getByRole("textbox")).toHaveValue(
      "Edited native content",
    );
    await expect
      .poll(() =>
        panes.evaluateAll((contents) =>
          contents.map((content) => content.getBoundingClientRect().toJSON()),
        ),
      )
      .toEqual(bounds);
  });

  test("preserves half-CSS-pixel detail in live and cached images", async ({
    page,
  }) => {
    await openCanvas(page);
    const result = await page.evaluate(async () => {
      const fixture = window.__paneCanvasFixture;
      const content = fixture.canvas.firstElementChild as HTMLElement;
      content.replaceChildren();
      content.style.background =
        "repeating-linear-gradient(90deg, #000 0 .5px, #fff .5px 1px)";
      fixture.pane.style.transform = "none";
      fixture.motionRenderer = "canvas";
      fixture.live = true;
      fixture.surface.requestPaint();
      await new Promise<void>((resolve) =>
        fixture.canvas.addEventListener("paint", () => resolve(), {
          once: true,
        }),
      );
      const snapshot = await fixture.surface.capture({
        stage: false,
        signal: AbortSignal.timeout(5000),
        maxEncodedBytes: 8 * 1024 * 1024,
        maxRasterBytes: 16 * 1024 * 1024,
      });
      const bitmap = await createImageBitmap(snapshot.image);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const reader = canvas.getContext("2d")!;
      reader.drawImage(bitmap, 0, 0);
      const data = reader.getImageData(20, 20, 8, 1).data;
      bitmap.close();
      return {
        width: snapshot.width,
        height: snapshot.height,
        levels: Array.from({ length: 8 }, (_, i) => data[i * 4]),
      };
    });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.levels).toEqual([0, 255, 0, 255, 0, 255, 0, 255]);
  });
});

test("cross-origin iframe capture fails explicitly and restores staging", async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(async () => {
    const iframe = window.__paneCanvasFixture.iframe;
    const url = new URL(iframe.src);
    url.hostname = "localhost";
    await new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
      iframe.src = url.href;
    });
  });
  const message = await page.evaluate(async () => {
    try {
      await window.__paneCanvasFixture.surface.capture({
        signal: AbortSignal.timeout(5000),
        stage: true,
        maxRasterBytes: 128 * 1024 * 1024,
        maxEncodedBytes: 32 * 1024 * 1024,
      });
      return "accepted";
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(message).toContain("cross-origin iframe");
  await expect(page.locator(":popover-open")).toHaveCount(0);
});

async function redPixelBounds(page: Page) {
  const screenshot = await page.locator("#pane").screenshot();
  return page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (value) =>
      value.charCodeAt(0),
    );
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = Infinity,
      minY = Infinity,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i]! > 240 && data[i + 1]! < 15 && data[i + 2]! < 15) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    bitmap.close();
    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }, screenshot.toString("base64"));
}

async function nativeContentPixels(page: Page): Promise<Buffer> {
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    const content = document.querySelector<HTMLElement>("#content")!;
    const reference = document.createElement("div");
    reference.id = "native-reference";
    reference.className = fixture.canvas.className;
    reference.style.cssText = fixture.canvas.style.cssText;
    fixture.canvas.after(reference);
    reference.moveBefore(content, null);
  });
  try {
    return await page.locator("#content").screenshot();
  } finally {
    await page.evaluate(() => {
      const fixture = window.__paneCanvasFixture;
      fixture.canvas.moveBefore(document.querySelector("#content")!, null);
      document.querySelector("#native-reference")!.remove();
    });
  }
}

test.describe("nested canvas pixels in headless Chrome", () => {
  test("preserves text, borders and iframe geometry between live and frozen presentation", async ({
    playwright,
    baseURL,
  }) => {
    const browser = await playwright.chromium.launch({
      ...chromeLaunchOptions,
      headless: true,
    });
    const page = await browser.newPage({
      baseURL,
      deviceScaleFactor: 2,
      viewport: { width: 1280, height: 900 },
    });
    try {
      await openCanvas(page);
      await page.evaluate(() => {
        const fixture = window.__paneCanvasFixture;
        const content = document.querySelector<HTMLElement>("#content")!;
        content.className = "onirigiri-pane__live-content";
        content.style.cssText =
          "font:13px sans-serif;background:white;color:black";
        const markup =
          '<header style="display:flex;justify-content:space-between;border-bottom:1px solid;padding:13px"><label>Field notes</label><span>152 characters</span></header><div style="padding:13px"><span style="border:1px solid;padding:3px">Navigation</span><p>A spatial interface should keep the same layout when motion settles.</p><textarea style="display:block;width:90%;height:48px;font:inherit">Keep this edit</textarea></div>';
        content.replaceChildren();
        const direct = document.createElement("section");
        direct.innerHTML = markup;
        content.append(direct, fixture.iframe);
        fixture.iframe.style.height = "300px";
        fixture.document.body.style.cssText =
          "margin:0;font:13px sans-serif;background:white;color:black";
        fixture.document.body.innerHTML = markup;
        fixture.pane.style.height = "600px";
        fixture.pane.style.transform = "none";
        fixture.live = true;
        fixture.surface.requestPaint();
      });
      await expect(page.locator("#content")).toHaveAttribute(
        "data-onirigiri-live",
        "true",
      );
      const geometry = () =>
        page.evaluate(() => {
          const fixture = window.__paneCanvasFixture;
          const content = document.querySelector<HTMLElement>("#content")!;
          return [content, fixture.document.body].map((root) => {
            const origin = root.getBoundingClientRect();
            return [root, ...root.querySelectorAll("*")].map((node) => {
              const rect = node.getBoundingClientRect();
              return [
                rect.x - origin.x,
                rect.y - origin.y,
                rect.width,
                rect.height,
              ];
            });
          });
        });
      for (const width of [400, 401, 480]) {
        await page.evaluate((width) => {
          window.__paneCanvasFixture.pane.style.width = `${width}px`;
        }, width);
        const native = await geometry();
        const version = await page.evaluate(() => {
          const fixture = window.__paneCanvasFixture;
          fixture.live = false;
          fixture.surface.requestPaint();
          return fixture.surface.frameVersion;
        });
        await expect
          .poll(() =>
            page.evaluate(
              () => window.__paneCanvasFixture.surface.frameVersion,
            ),
          )
          .toBeGreaterThan(version);
        expect(await geometry()).toEqual(native);
        const nativePixels = await nativeContentPixels(page);
        const difference = await page.evaluate(async (encoded) => {
          const fixture = window.__paneCanvasFixture;
          const pixels = async (url: string) => {
            const image = await createImageBitmap(
              await (await fetch(url)).blob(),
            );
            const canvas = new OffscreenCanvas(image.width, image.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            image.close();
            return context.getImageData(0, 0, canvas.width, canvas.height);
          };
          const native = await pixels(`data:image/png;base64,${encoded}`);
          const motion = await pixels(fixture.canvas.toDataURL());
          let maximumError = 0;
          let totalError = 0;
          for (let index = 0; index < native.data.length; index++) {
            const error = Math.abs(native.data[index]! - motion.data[index]!);
            maximumError = Math.max(maximumError, error);
            totalError += error;
          }
          return {
            dimensions: [motion.width, motion.height],
            expectedDimensions: [native.width, native.height],
            maximumError,
            meanError: totalError / native.data.length,
          };
        }, nativePixels.toString("base64"));
        expect(difference.dimensions).toEqual(difference.expectedDimensions);
        expect(difference.maximumError).toBeLessThanOrEqual(8);
        expect(difference.meanError).toBeLessThan(0.001);
        await page.evaluate(() => {
          const fixture = window.__paneCanvasFixture;
          fixture.live = true;
          fixture.surface.requestPaint();
        });
        await expect(page.locator("#content")).toHaveAttribute(
          "data-onirigiri-live",
          "true",
        );
        expect(await geometry()).toEqual(native);
        expect(await page.locator("#content textarea").inputValue()).toBe(
          "Keep this edit",
        );
      }
      expect(
        await page.evaluate(() => window.__paneCanvasFixture.error),
      ).toBeNull();
      await page.evaluate(() => window.__paneCanvasFixture.surface.dispose());
      expect(await page.locator("#canvas > #content").count()).toBe(1);
    } finally {
      await browser.close();
    }
  });

  for (const framed of [false, true]) {
    test(`matches native crop through motion and resizing ${framed ? "inside an iframe" : "in the pane"}`, async ({
      playwright,
      baseURL,
    }) => {
      const browser = await playwright.chromium.launch({
        ...chromeLaunchOptions,
        headless: true,
      });
      const page = await browser.newPage({
        baseURL,
        deviceScaleFactor: 2,
        viewport: { width: 1280, height: 900 },
      });
      try {
        await openCanvas(page);
        const identity = await page.evaluate((framed) => {
          const fixture = window.__paneCanvasFixture;
          const content = document.querySelector<HTMLElement>("#content")!;
          content.style.cssText =
            "width:100%;height:100%;position:relative;overflow:hidden";
          const host = framed ? fixture.document.body : content;
          if (framed) {
            fixture.document.documentElement.style.height = "100%";
            host.style.cssText =
              "margin:0;width:100%;height:100%;position:relative;overflow:hidden";
            for (const child of [...content.children]) {
              if (child !== fixture.iframe) child.remove();
            }
            fixture.iframe.style.height = "100%";
          }
          host.innerHTML =
            '<canvas width="960" height="540" style="position:absolute;width:960px;height:540px;left:50%;top:50%;transform-origin:center"></canvas><div style="position:absolute;right:12px;bottom:12px;width:32px;height:24px;background:#ff00ff"></div>';
          const canvas = host.querySelector("canvas")!;
          const context = canvas.getContext("2d")!;
          context.fillStyle = "#123456";
          context.fillRect(0, 0, 960, 540);
          for (let y = 30; y < 540; y += 60) {
            for (let x = 30; x < 960; x += 60) {
              context.fillStyle = x % 120 === 30 ? "#6af0ac" : "#f0b34c";
              context.beginPath();
              context.arc(x, y, 13, 0, Math.PI * 2);
              context.fill();
            }
          }
          const fit = () => {
            const scale = Math.max(
              host.clientWidth / 960,
              host.clientHeight / 540,
            );
            canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
          };
          new ResizeObserver(fit).observe(host);
          fit();
          canvas.dataset.identity = "original";
          fixture.pane.style.transform = "none";
          fixture.live = true;
          fixture.surface.requestPaint();
          return canvas.toDataURL();
        }, framed);
        for (const [width, height] of [
          [400, 600],
          [700, 260],
          [320, 500],
        ]) {
          await page.evaluate(
            ({ width, height }) => {
              const fixture = window.__paneCanvasFixture;
              fixture.surface.setResizing(true);
              fixture.pane.style.width = `${width}px`;
              fixture.pane.style.height = `${height}px`;
              fixture.live = true;
              fixture.surface.setResizing(false);
            },
            { width, height },
          );
          await expect(page.locator("#content")).toHaveAttribute(
            "data-onirigiri-live",
            "true",
          );
          const version = await page.evaluate(() => {
            const fixture = window.__paneCanvasFixture;
            fixture.live = false;
            const version = fixture.surface.frameVersion;
            fixture.surface.requestPaint();
            return version;
          });
          await expect
            .poll(() =>
              page.evaluate(
                () => window.__paneCanvasFixture.surface.frameVersion,
              ),
            )
            .toBeGreaterThan(version);
          const native = await nativeContentPixels(page);
          const result = await page.evaluate(
            async ({ native, framed }) => {
              const fixture = window.__paneCanvasFixture;
              async function pixels(blob: Blob) {
                const bitmap = await createImageBitmap(blob);
                const reader = new OffscreenCanvas(bitmap.width, bitmap.height);
                const context = reader.getContext("2d")!;
                context.drawImage(bitmap, 0, 0);
                bitmap.close();
                return context.getImageData(0, 0, reader.width, reader.height);
              }
              const expected = await pixels(
                await (await fetch(`data:image/png;base64,${native}`)).blob(),
              );
              const images = [
                await new Promise<Blob>((resolve) =>
                  fixture.canvas.toBlob((blob) => resolve(blob!)),
                ),
              ];
              for (const stage of [false, true]) {
                if (stage)
                  fixture.pane.style.transform = "translate(-900px,-700px)";
                const captured = await fixture.surface.capture({
                  stage,
                  signal: AbortSignal.timeout(5000),
                  maxRasterBytes: 16 * 1024 * 1024,
                  maxEncodedBytes: 8 * 1024 * 1024,
                });
                images.push(captured.image);
              }
              fixture.pane.style.transform = "none";
              const differences = [];
              for (const image of images) {
                const actual = await pixels(image);
                let error = 0;
                let mismatches = 0;
                for (
                  let offset = 0;
                  offset < expected.data.length;
                  offset += 4
                ) {
                  let difference = 0;
                  for (let channel = 0; channel < 4; channel++)
                    difference += Math.abs(
                      actual.data[offset + channel]! -
                        expected.data[offset + channel]!,
                    );
                  error += difference;
                  if (difference > 20) mismatches++;
                }
                differences.push({
                  dimensions: [actual.width, actual.height],
                  meanError: error / expected.data.length,
                  mismatches: mismatches / (expected.data.length / 4),
                });
              }
              const owner = framed
                ? fixture.document
                : document.querySelector<HTMLElement>("#content")!;
              const canvas = owner.querySelector<HTMLCanvasElement>(
                'canvas[data-identity="original"]',
              )!;
              return {
                differences,
                bitmap: canvas.toDataURL(),
                source: [canvas.width, canvas.height],
                content: [
                  document.querySelector<HTMLElement>("#content")!.offsetWidth,
                  document.querySelector<HTMLElement>("#content")!.offsetHeight,
                ],
                sameDocument:
                  fixture.iframe.contentDocument === fixture.document,
                error: fixture.error,
              };
            },
            { native: native.toString("base64"), framed },
          );
          expect(result.bitmap).toBe(identity);
          expect(result.source).toEqual([960, 540]);
          expect(result.content).toEqual([width, height]);
          if (framed) expect(result.sameDocument).toBe(true);
          expect(result.error).toBeNull();
          for (const difference of result.differences) {
            expect(difference.dimensions).toEqual([width! * 2, height! * 2]);
            expect(difference.meanError).toBeLessThan(0.5);
            expect(difference.mismatches).toBeLessThan(0.005);
          }
        }
      } finally {
        await browser.close();
      }
    });
  }
});

for (const framed of [false, true]) {
  test(`capture suppresses scrollbar pixels and restores native scrolling ${framed ? "inside an iframe" : "in the pane"}`, async ({
    playwright,
    baseURL,
  }) => {
    const browser = await playwright.chromium.launch({
      ...chromeLaunchOptions,
      headless: true,
      ignoreDefaultArgs: ["--hide-scrollbars"],
    });
    const page = await browser.newPage({
      baseURL,
      deviceScaleFactor: 2,
      viewport: { width: 1280, height: 900 },
    });
    try {
      await openCanvas(page);
      await page.evaluate((framed) => {
        const fixture = window.__paneCanvasFixture;
        const content = document.querySelector<HTMLElement>("#content")!;
        content.className = "onirigiri-pane__live-content";
        const host = framed ? fixture.document.body : content;
        if (framed) {
          fixture.document.documentElement.style.height = "100%";
          host.style.cssText = "margin:0;width:100%;height:100%";
          for (const child of [...content.children])
            if (child !== fixture.iframe) child.remove();
          fixture.iframe.style.height = "100%";
        }
        host.innerHTML =
          '<div id="scrollbox" style="width:100%;height:100%;overflow:scroll;scroll-behavior:smooth;scrollbar-color:rgb(255,0,255) rgb(20,59,69);background:rgb(20,59,69)"><div style="width:900px;height:1200px;background:rgb(20,59,69)"></div></div>';
        fixture.pane.style.transform = "none";
        fixture.live = true;
        fixture.surface.requestPaint();
      }, framed);
      await expect(page.locator("#content")).toHaveAttribute(
        "data-onirigiri-live",
        "true",
      );
      const scroller = framed
        ? page.frameLocator("iframe").locator("#scrollbox")
        : page.locator("#scrollbox");
      const before = await scroller.evaluate((element) => {
        element.scrollTo({ left: 73, top: 137, behavior: "instant" });
        return {
          left: element.scrollLeft,
          top: element.scrollTop,
          width: element.clientWidth,
          height: element.clientHeight,
          style: element.getAttribute("style"),
          color: getComputedStyle(element).scrollbarColor,
          styles: [...element.ownerDocument.querySelectorAll("style")].map(
            (style) => style.textContent,
          ),
        };
      });
      expect([before.left, before.top]).toEqual([73, 137]);
      const version = await page.evaluate(() => {
        const fixture = window.__paneCanvasFixture;
        fixture.live = false;
        const version = fixture.surface.frameVersion;
        fixture.surface.requestPaint();
        return version;
      });
      await expect
        .poll(() =>
          page.evaluate(() => window.__paneCanvasFixture.surface.frameVersion),
        )
        .toBeGreaterThan(version);
      const images = await page.evaluate(async () => {
        const fixture = window.__paneCanvasFixture;
        const images = [
          await new Promise<Blob>((resolve) =>
            fixture.canvas.toBlob((blob) => resolve(blob!)),
          ),
        ];
        for (const stage of [false, true]) {
          if (stage) fixture.pane.style.transform = "translate(-900px,-700px)";
          images.push(
            (
              await fixture.surface.capture({
                stage,
                signal: AbortSignal.timeout(5000),
                maxRasterBytes: 16 * 1024 * 1024,
                maxEncodedBytes: 8 * 1024 * 1024,
              })
            ).image,
          );
        }
        const pixels = [];
        for (const image of images) {
          const bitmap = await createImageBitmap(image);
          const reader = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = reader.getContext("2d")!;
          context.drawImage(bitmap, 0, 0);
          const data = context.getImageData(
            0,
            0,
            reader.width,
            reader.height,
          ).data;
          let scrollbarPixels = 0;
          for (let offset = 0; offset < data.length; offset += 4) {
            if (
              data[offset]! > 220 &&
              data[offset + 1]! < 30 &&
              data[offset + 2]! > 220 &&
              data[offset + 3]! > 240
            )
              scrollbarPixels++;
          }
          pixels.push({
            scrollbarPixels,
            center: [
              ...context.getImageData(reader.width / 2, reader.height / 2, 1, 1)
                .data,
            ],
          });
          bitmap.close();
        }
        return pixels;
      });
      for (const image of images) {
        expect(image.scrollbarPixels).toBe(0);
        expect(image.center).toEqual([20, 59, 69, 255]);
      }
      const frozen = await scroller.evaluate((element) => ({
        left: element.scrollLeft,
        top: element.scrollTop,
        width: element.clientWidth,
        height: element.clientHeight,
        style: element.getAttribute("style"),
      }));
      expect(frozen).toEqual({
        left: before.left,
        top: before.top,
        width: before.width,
        height: before.height,
        style: before.style,
      });
      const cancelled = await page.evaluate(async () => {
        const fixture = window.__paneCanvasFixture;
        const controller = new AbortController();
        const capture = fixture.surface.capture({
          stage: true,
          signal: controller.signal,
          maxRasterBytes: 16 * 1024 * 1024,
          maxEncodedBytes: 8 * 1024 * 1024,
        });
        controller.abort();
        const rejected = await capture.then(
          () => false,
          () => true,
        );
        fixture.pane.style.transform = "none";
        fixture.live = true;
        fixture.surface.requestPaint();
        return { rejected, staged: fixture.canvas.hasAttribute("popover") };
      });
      expect(cancelled).toEqual({ rejected: true, staged: false });
      await expect(page.locator("#content")).toHaveAttribute(
        "data-onirigiri-live",
        "true",
      );
      const restored = await scroller.evaluate((element) => ({
        left: element.scrollLeft,
        top: element.scrollTop,
        width: element.clientWidth,
        height: element.clientHeight,
        style: element.getAttribute("style"),
        color: getComputedStyle(element).scrollbarColor,
        styles: [...element.ownerDocument.querySelectorAll("style")].map(
          (style) => style.textContent,
        ),
      }));
      expect(restored).toEqual(before);
      await scroller.hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, 180);
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(before.top);
      const disposed = await page.evaluate(() => {
        const fixture = window.__paneCanvasFixture;
        fixture.live = false;
        fixture.surface.requestPaint();
        fixture.surface.dispose();
        return {
          sameDocument: fixture.iframe.contentDocument === fixture.document,
          styles: [...fixture.document.querySelectorAll("style")].map(
            (style) => style.textContent,
          ),
          error: fixture.error,
        };
      });
      expect(disposed.error).toBeNull();
      if (framed) {
        expect(disposed.sameDocument).toBe(true);
        expect(disposed.styles).toEqual(before.styles);
      }
    } finally {
      await browser.close();
    }
  });
}

for (const dpr of [1, 2]) {
  test.describe(`canvas pointer input at pixel ratio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test("pointer input reaches live content presented through the canvas", async ({
      page,
    }) => {
      await page.goto(
        `/@fs${repositoryRoot}tests/browser/native-content-guard.html?grid&count=2&liveContent&pictures&auto`,
      );
      const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
      await page.evaluate(() =>
        window.__nativeMotionFixture.setPresentation("pane-1", "canvas"),
      );
      await expect(pane).toHaveAttribute("data-onirigiri-renderer", "canvas");
      await expect(pane).toHaveAttribute(
        "data-onirigiri-presentation-live",
        "true",
      );
      await expectLiveColors(page, "pane-1");
      const textbox = pane.frameLocator("iframe").getByRole("textbox");
      await textbox.evaluate((element) => {
        (element as HTMLInputElement).value = "";
      });
      await expect(
        pane.locator('[data-onirigiri-slot="pane-live-content"]'),
      ).not.toHaveAttribute("inert");
      const bounds = (await textbox.boundingBox())!;
      await page.mouse.click(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await page.keyboard.type("Typed through the canvas");
      await expect(textbox).toHaveValue("Typed through the canvas");
      await expect(pane).toHaveAttribute("data-onirigiri-renderer", "canvas");
    });
  });
}

test("presentation policies distinguish live canvas, retained previews and custom placeholders without replacing content", async ({
  page,
}) => {
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?grid&count=2&liveContent&pictures&auto&customPlaceholder`,
  );
  const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
  await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
  const original = await pane.locator("iframe").evaluateHandle((element) => {
    const iframe = element as HTMLIFrameElement;
    iframe.contentDocument!.querySelector("input")!.value =
      "Keep this application";
    return { iframe, document: iframe.contentDocument };
  });
  await page.evaluate(() =>
    window.__nativeMotionFixture.setPresentation("pane-1", "canvas"),
  );
  await expect(pane).toHaveAttribute("data-onirigiri-renderer", "canvas");
  await expect(pane).toHaveAttribute(
    "data-onirigiri-presentation-live",
    "true",
  );
  await expectLiveColors(page, "pane-1");
  await pane.frameLocator("iframe").getByRole("textbox").focus();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgb(40,180,80)";
    context.fillRect(0, 0, 400, 200);
    await window.__nativeMotionFixture.supplyPicture(
      "pane-1",
      canvas.toDataURL(),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__nativeMotionFixture.handle
          .current!.getCaptureStatus()
          .pictures.some((picture) => picture.paneId === "pane-1"),
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    window.__nativeMotionFixture.setPresentation("pane-1", {
      kind: "texture",
      detail: "preview",
    }),
  );
  await expect(pane).toHaveAttribute("data-onirigiri-renderer", "texture");
  await expect(pane).toBeFocused();
  await expect(pane).toHaveAttribute(
    "data-onirigiri-presentation-live",
    "false",
  );
  expect(
    await pane
      .locator('[data-onirigiri-slot="pane-picture"]')
      .evaluate((canvas: HTMLCanvasElement) =>
        Math.max(canvas.width, canvas.height),
      ),
  ).toBeLessThanOrEqual(128);
  const bounds = (await pane
    .locator('[data-onirigiri-slot="pane-content"]')
    .boundingBox())!;
  const screenshot = await page.screenshot({
    clip: {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      width: 1,
      height: 1,
    },
  });
  const preview = await page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
    );
    const context = new OffscreenCanvas(1, 1).getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return [...context.getImageData(0, 0, 1, 1).data];
  }, screenshot.toString("base64"));
  expect(preview).toEqual([40, 180, 80, 255]);
  await page.evaluate(() =>
    window.__nativeMotionFixture.setPresentation("pane-1", {
      kind: "placeholder",
      variant: "game-paused",
    }),
  );
  await expect(pane).toHaveAttribute("data-onirigiri-renderer", "placeholder");
  await expect(
    pane.locator('[data-fixture-placeholder="game-paused"]'),
  ).toBeVisible();
  expect(
    await pane
      .locator('[data-onirigiri-slot="pane-live-content"]')
      .evaluate((element: HTMLElement) => element.offsetWidth),
  ).toBeGreaterThan(0);
  await pane.locator('[data-fixture-placeholder="game-paused"]').click();
  await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
  await expect(pane).toHaveAttribute(
    "data-onirigiri-presentation-live",
    "true",
  );
  expect(
    await original.evaluate(
      ({ iframe, document }) =>
        iframe.contentDocument === document &&
        document!.querySelector("input")!.value === "Keep this application",
    ),
  ).toBe(true);
  await original.dispose();
});

test("texture policies freeze fresh visible pixels without supplied pictures and restore native content", async ({
  page,
}) => {
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?grid&count=2&policy&auto&preloadMargin=0`,
  );
  const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
  await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
  for (const detail of ["full", "preview"] as const) {
    const color = detail === "full" ? [30, 180, 70, 255] : [40, 60, 220, 255];
    await pane.locator("iframe").evaluate((element, color) => {
      (
        element as HTMLIFrameElement
      ).contentDocument!.documentElement.style.backgroundColor =
        `rgb(${color.slice(0, 3).join(",")})`;
    }, color);
    await page.evaluate(
      (detail) =>
        window.__nativeMotionFixture.setPresentation("pane-1", {
          kind: "texture",
          detail,
        }),
      detail,
    );
    await expect(pane).toHaveAttribute("data-onirigiri-renderer", "texture");
    await expect(
      pane.locator('[data-onirigiri-slot="pane-content"]'),
    ).toHaveAttribute("data-runtime-state", "frozen");
    const canvas = pane.locator(".onirigiri-pane__live-surface");
    if (detail === "preview")
      expect(
        await canvas.evaluate((element: HTMLCanvasElement) =>
          Math.max(element.width, element.height),
        ),
      ).toBeLessThanOrEqual(128);
    const bounds = (await canvas.boundingBox())!;
    const screenshot = await page.screenshot({
      clip: {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height * 0.8,
        width: 1,
        height: 1,
      },
    });
    const pixel = await page.evaluate(async (encoded) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
      );
      const context = new OffscreenCanvas(1, 1).getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...context.getImageData(0, 0, 1, 1).data];
    }, screenshot.toString("base64"));
    expect(pixel).toEqual(color);
    await pane.locator("iframe").evaluate((element) => {
      (
        element as HTMLIFrameElement
      ).contentDocument!.documentElement.style.backgroundColor = "red";
    });
    await page.waitForTimeout(100);
    const after = await page.screenshot({
      clip: {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height * 0.8,
        width: 1,
        height: 1,
      },
    });
    expect(after.equals(screenshot)).toBe(true);
    await page.evaluate(() =>
      window.__nativeMotionFixture.setPresentation("pane-1", "dom"),
    );
    await expect(pane).toHaveAttribute("data-onirigiri-renderer", "dom");
  }
});

test("hidden live surfaces skip final captures and redraw on reentry", async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.pane.style.transform = "none";
    const content = document.querySelector<HTMLElement>("#content")!;
    content.innerHTML = "Live content";
    fixture.live = true;
    fixture.motionRenderer = "canvas";
    fixture.surface.requestPaint();
  });
  await expect
    .poll(() => page.evaluate(() => window.__paneCanvasFixture.drawn))
    .toBe(true);
  const before = await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.live = false;
    fixture.visible = false;
    fixture.pane.style.transform = "translateX(-2000px)";
    document.querySelector<HTMLElement>("#content")!.textContent =
      "Updated while hidden";
    const version = fixture.surface.frameVersion;
    fixture.surface.requestPaint();
    return version;
  });
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => window.__paneCanvasFixture.surface.frameVersion),
  ).toBe(before);
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.live = true;
    fixture.visible = true;
    fixture.pane.style.transform = "none";
    fixture.surface.requestPaint();
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__paneCanvasFixture.surface.frameVersion),
    )
    .toBeGreaterThan(before);
  await expect(page.locator("#content")).toHaveText("Updated while hidden");
});

test("native content recovers after a GPU device loss during canvas presentation", async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.pane.style.transform = "none";
    document.querySelector("#gpu")!.remove();
    fixture.live = true;
    fixture.motionRenderer = "canvas";
    fixture.surface.requestPaint();
  });
  await expect
    .poll(() => page.evaluate(() => window.__paneCanvasFixture.drawn))
    .toBe(true);
  const original = await page.locator("iframe").elementHandle();
  await page.evaluate(() => window.__paneCanvasFixture.device!.destroy());
  await expect
    .poll(() => page.evaluate(() => window.__paneCanvasFixture.error))
    .toContain("device lost");
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    fixture.motionRenderer = "dom";
    fixture.surface.requestPaint();
  });
  await expect(page.locator("#canvas")).toHaveAttribute(
    "data-onirigiri-native-active",
    "true",
  );
  expect(
    await page
      .locator("iframe")
      .evaluate((iframe, original) => iframe === original, original),
  ).toBe(true);
  await expect(page.frameLocator("iframe").getByRole("textbox")).toHaveValue(
    "Keep this edit",
  );
});
