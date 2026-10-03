import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { picturePixels } from "./picture-pixels";
import type { NativeMotionFixture } from "./native-content-scene";
import { chromeLaunchOptions } from "./chrome-launch";

test.use({
  deviceScaleFactor: 1,
  launchOptions: {
    ...chromeLaunchOptions,
    args: ["--force-device-scale-factor=1", ...chromeLaunchOptions.args],
  },
  trace: { mode: "retain-on-failure", screenshots: false, snapshots: false },
});

declare global {
  interface Window {
    __nativeMotionFixture: NativeMotionFixture;
    __retainedNativeFrames: Map<string, HTMLIFrameElement>;
    __nativeContentWork: { snapshot(): { running: boolean; ticks: number } };
    __backgroundCaptureTrace: {
      maximumColdDocuments: number;
      warmups: { id: string; start: number; end: number | null }[];
    };
  }
}

const repositoryRoot = new URL("../../", import.meta.url).pathname;

async function openNativeFixture(
  page: Page,
  dense?: boolean,
  pictures = false,
  options: {
    budgetBytes?: number;
    rasterBudgetBytes?: number;
    cooperative?: boolean;
    count?: number;
    preloadMargin?: number;
    allPictures?: boolean;
  } = {},
): Promise<void> {
  const parameters = new URLSearchParams();
  if (dense) parameters.set("dense", "");
  if (pictures) parameters.set("pictures", "");
  if (options.cooperative) parameters.set("cooperative", "");
  if (options.allPictures) parameters.set("allPictures", "");
  for (const [key, value] of Object.entries({
    count: options.count,
    budget: options.budgetBytes,
    rasterBudget: options.rasterBudgetBytes,
    preloadMargin: options.preloadMargin,
  })) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  await page.goto(
    `/@fs${repositoryRoot}tests/browser/native-content-guard.html?${parameters}`,
  );
  await expect(
    page.locator('[data-onirigiri-pane-id="pane-1"] iframe'),
  ).toBeVisible();
}

test("leaves wheel input to browser scrolling without changing workspace geometry", async ({
  page,
}) => {
  await openNativeFixture(page, false, false, { count: 8, preloadMargin: 0 });
  const pane = page.locator('[data-onirigiri-pane-id="pane-1"]');
  await expect(pane).toHaveAttribute("data-moving", "false");
  const frame = page.frameLocator('[data-onirigiri-pane-id="pane-1"] iframe');
  await frame.getByRole("textbox").fill("Keep my edit");
  await frame.locator("body").evaluate((body) => {
    body.style.minHeight = "3000px";
  });
  await frame.getByRole("heading").hover();
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => frame.locator("html").evaluate(() => window.scrollY))
    .toBeGreaterThan(0);

  for (const mode of ["normal", "overview"] as const) {
    if (mode === "overview") {
      await page.evaluate(() =>
        window.__nativeMotionFixture.handle.current!.toggleOverview(),
      );
      await expect(pane).toHaveAttribute("data-moving", "false");
    }
    const result = await page.evaluate(async () => {
      const handle = window.__nativeMotionFixture.handle.current!;
      const geometry = () => {
        const snapshot = handle.getSnapshot();
        return {
          cursor: snapshot.cursor,
          focusedPaneId: snapshot.focusedPaneId,
          presentationMode: snapshot.presentationMode,
          scrollColumn: snapshot.scrollColumn,
          scrollRow: snapshot.scrollRow,
          overviewProgress: snapshot.overviewProgress,
          overviewZoom: snapshot.overviewZoom,
          overviewPanX: snapshot.overviewPanX,
          overviewPanY: snapshot.overviewPanY,
          bounds: document
            .querySelector('[data-onirigiri-pane-id="pane-1"]')!
            .getBoundingClientRect()
            .toJSON(),
        };
      };
      const before = geometry();
      const prevented: boolean[] = [];
      for (const selector of [
        ".onirigiri-workspace",
        '[data-onirigiri-slot="stage"]',
        '[data-onirigiri-pane-id="pane-1"] .onirigiri-pane__titlebar',
        ".onirigiri-workspace__toolbar",
      ]) {
        const target = document.querySelector(selector)!;
        for (const sample of [
          { deltaX: 96.5 },
          { deltaX: -96.5 },
          { deltaY: 96.5 },
          { deltaY: -96.5 },
          { deltaY: 120 },
          { deltaY: 60, ctrlKey: true },
          { deltaY: -60, ctrlKey: true },
          { deltaY: 60, metaKey: true },
          { deltaY: 3, deltaMode: 1 },
        ]) {
          const event = new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            ...sample,
          });
          target.dispatchEvent(event);
          prevented.push(event.defaultPrevented);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      await new Promise(requestAnimationFrame);
      return { before, after: geometry(), prevented };
    });
    expect(result.prevented).toEqual(result.prevented.map(() => false));
    expect(result.after).toEqual(result.before);
    expect(result.after.presentationMode).toBe(mode);
  }
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect(pane).toHaveAttribute("data-moving", "false");
  await expect(frame.getByRole("textbox")).toHaveValue("Keep my edit");
});

for (const transition of ["overview", "pane moves"] as const) {
  test(`retained documents survive ${transition} after leaving the initial region`, async ({
    page,
  }) => {
    await openNativeFixture(page, false, false, { count: 50 });
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-41"),
    );
    await expect
      .poll(() =>
        page
          .locator('[data-moving="true"][data-onirigiri-slot="pane"]')
          .count(),
      )
      .toBe(0);
    await expect(
      page
        .frameLocator('[data-onirigiri-pane-id="pane-41"] iframe')
        .getByRole("textbox"),
    ).toBeVisible();
    const retained = await page
      .locator('[data-onirigiri-slot="pane"] iframe')
      .evaluateAll((elements) =>
        elements.map((element) => {
          window.__retainedNativeFrames ??= new Map();
          const iframe = element as HTMLIFrameElement;
          const id = iframe.closest<HTMLElement>(
            '[data-onirigiri-slot="pane"]',
          )!.dataset.onirigiriPaneId!;
          window.__retainedNativeFrames.set(id, iframe);
          iframe.contentDocument!.querySelector("input")!.value =
            `Saved state for ${id}`;
          return { id, origin: iframe.contentWindow!.performance.timeOrigin };
        }),
      );
    expect(retained.some(({ id }) => id === "pane-41")).toBe(true);
    expect(retained.length).toBeGreaterThan(1);
    for (let iteration = 0; iteration < 4; iteration += 1) {
      await page.evaluate(
        ({ transition, iteration }) => {
          const workspace = window.__nativeMotionFixture.handle.current!;
          if (transition === "overview") workspace.toggleOverview();
          else workspace.movePane(iteration % 2 === 0 ? "right" : "left");
        },
        { transition, iteration },
      );
      await expect
        .poll(() =>
          page
            .locator('[data-moving="true"][data-onirigiri-slot="pane"]')
            .count(),
        )
        .toBe(0);
      const current = await page
        .locator('[data-onirigiri-slot="pane"] iframe')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const iframe = element as HTMLIFrameElement;
            return {
              id: iframe.closest<HTMLElement>('[data-onirigiri-slot="pane"]')!
                .dataset.onirigiriPaneId!,
              origin: iframe.contentWindow!.performance.timeOrigin,
              value: iframe.contentDocument!.querySelector("input")?.value,
            };
          }),
        );
      let preserved = 0;
      for (const before of retained) {
        const after = current.find(({ id }) => id === before.id);
        if (!after) continue;
        const retention = await page.evaluate((id) => {
          const original = window.__retainedNativeFrames.get(id)!;
          const pane = document.querySelector(
            `[data-onirigiri-pane-id="${id}"]`,
          )!;
          return {
            retained: original.isConnected,
            same: pane.querySelector("iframe") === original,
            picture: !!pane.querySelector(
              'canvas[data-onirigiri-slot="pane-picture"]',
            ),
          };
        }, before.id);
        if (!retention.retained) {
          expect(retention.picture, before.id).toBe(true);
          continue;
        }
        expect(retention.same, before.id).toBe(true);
        expect(after.origin, before.id).toBe(before.origin);
        expect(after.value, before.id).toBe(`Saved state for ${before.id}`);
        preserved += 1;
      }
      expect(preserved).toBeGreaterThan(1);
      expect(current.some(({ id }) => id === "pane-41")).toBe(true);
    }
  });
}

async function holdClock(page: Page): Promise<() => Promise<void>> {
  const release = await page.evaluateHandle(async () => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    let time = performance.now();
    window.requestAnimationFrame = (callback) => {
      callbacks.set(++id, callback);
      return id;
    };
    window.cancelAnimationFrame = (key) => {
      callbacks.delete(key);
    };
    window.__nativeMotionFixture.step = () => {
      time += 1000 / 120;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(time);
    };
    await new Promise<void>((resolve) => requestFrame(() => resolve()));
    return () => {
      window.requestAnimationFrame = requestFrame;
      window.cancelAnimationFrame = cancelFrame;
      for (const callback of callbacks.values()) requestFrame(callback);
      callbacks.clear();
    };
  });
  return async () => {
    await release.evaluate((restore) => restore());
    await release.dispose();
  };
}

async function stepClock(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.evaluate(() => window.__nativeMotionFixture.step());
  }
}

test("a cold focused pane paints its first frame before navigation settles", async ({
  page,
}) => {
  await openNativeFixture(page, false, true, { count: 12, preloadMargin: 0 });
  await expect(
    page.locator(
      '[data-onirigiri-pane-id="pane-1"] [data-onirigiri-content-ready="true"]',
    ),
  ).toHaveCount(1);
  const destination = page.locator('[data-onirigiri-pane-id="pane-7"]');
  await expect(destination.locator("iframe")).toHaveCount(0);
  const releaseClock = await holdClock(page);
  try {
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-7"),
    );
    for (let step = 0; step < 90; step++) {
      await stepClock(page, 1);
      const bounds = await destination
        .locator("canvas.onirigiri-pane__live-surface")
        .boundingBox();
      if (bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1280) break;
    }
    await stepClock(page, 2);
    await expect(destination).toHaveAttribute("data-moving", "true");
    const content = destination.locator('[data-onirigiri-slot="pane-content"]');
    await expect(content).toHaveAttribute(
      "data-onirigiri-content-ready",
      "true",
    );
    await expect(content).toHaveAttribute("data-runtime-state", "frozen");
    await expect(
      destination.locator('[data-onirigiri-slot="pane-live-content"]'),
    ).toHaveAttribute("inert", "");
    const alpha = await destination
      .locator("canvas.onirigiri-pane__live-surface")
      .evaluate(async (canvas: HTMLCanvasElement) => {
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((blob) => resolve(blob!)),
        );
        const image = await createImageBitmap(blob);
        const sample = document.createElement("canvas");
        sample.width = sample.height = 1;
        const context = sample.getContext("2d")!;
        context.drawImage(image, 0, 0);
        image.close();
        return context.getImageData(0, 0, 1, 1).data[3];
      });
    expect(alpha).toBe(255);
    await stepClock(page, 160);
    await expect(destination).toHaveAttribute("data-moving", "false");
    await expect(
      destination.locator('[data-onirigiri-live="true"]'),
    ).toHaveCount(1);
  } finally {
    await releaseClock();
  }
});

async function visibleContent(page: Page) {
  return page.evaluate(() => {
    const stage = document
      .querySelector('[data-onirigiri-slot="stage"]')!
      .getBoundingClientRect();
    const intersects = (pane: HTMLElement) => {
      const bounds = pane.getBoundingClientRect();
      return (
        !pane.hidden &&
        bounds.right > stage.left &&
        bounds.left < stage.right &&
        bounds.bottom > stage.top &&
        bounds.top < stage.bottom
      );
    };
    return [
      ...document.querySelectorAll<HTMLElement>('[data-onirigiri-slot="pane"]'),
    ]
      .filter(intersects)
      .map((pane) => {
        const content = pane.querySelector<HTMLElement>(
          ".onirigiri-pane__live-content",
        );
        const placeholder = pane.querySelector(".onirigiri-pane__placeholder")!;
        return {
          id: pane.dataset.onirigiriPaneId!,
          inert: content?.inert,
          pointerEvents: content
            ? getComputedStyle(content).pointerEvents
            : "missing",
          mounted: !!pane.querySelector("iframe"),
          moving: pane.dataset.moving,
          placeholderOpacity: placeholder
            ? getComputedStyle(placeholder).opacity
            : "0",
          runtime: pane.dataset.runtimeState,
          visibility: content
            ? getComputedStyle(content).visibility
            : "missing",
        };
      });
  });
}

async function nativeGeometry(page: Page) {
  return page
    .locator('[data-onirigiri-pane-id="pane-2"] iframe')
    .evaluate((iframe) => {
      const chain = [];
      let element: HTMLElement | null = iframe as HTMLElement;
      while (element) {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        chain.push({
          name: element.className,
          dataset: { ...element.dataset },
          bounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
          transform: style.transform,
          opacity: style.opacity,
          willChange: style.willChange,
          backfaceVisibility: style.backfaceVisibility,
        });
        element = element.parentElement;
      }
      return chain;
    });
}

test("native retained frames remain visible through overview entry and return live", async ({
  page,
}, info) => {
  await openNativeFixture(page);
  const field = page
    .frameLocator('[data-onirigiri-pane-id="pane-2"] iframe')
    .getByRole("textbox");
  await expect(
    page.locator(
      '[data-onirigiri-pane-id="pane-2"] [data-onirigiri-live="true"]',
    ),
  ).toHaveCount(1);
  await field.fill("Preserved browser state");
  const documentBefore = await page
    .locator('[data-onirigiri-pane-id="pane-2"] iframe')
    .evaluate(
      (element) =>
        (element as HTMLIFrameElement).contentWindow!.performance.timeOrigin,
    );
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.focusPane("pane-4"),
  );
  await expect
    .poll(() =>
      page.locator('[data-moving="true"][data-onirigiri-slot="pane"]').count(),
    )
    .toBe(0);
  await expect(
    page.locator(
      '[data-onirigiri-pane-id="pane-4"] [data-onirigiri-live="true"]',
    ),
  ).toHaveCount(1);
  const warm = await page
    .locator('[data-onirigiri-slot="pane"]')
    .evaluateAll((panes) =>
      panes
        .filter((pane) =>
          pane.querySelector('[data-onirigiri-content-ready="true"]'),
        )
        .map((pane) => (pane as HTMLElement).dataset.onirigiriPaneId),
    );
  await holdClock(page);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await stepClock(page, 12);
  await page.screenshot({
    path: info.outputPath("native-overview-motion.png"),
  });
  const entering = (await visibleContent(page)).filter((pane) =>
    warm.includes(pane.id),
  );
  expect(entering.length).toBeGreaterThan(0);
  expect(entering.some((pane) => pane.moving === "true")).toBe(true);
  for (const pane of entering) {
    expect(pane.visibility, pane.id).toBe("visible");
    expect(pane.placeholderOpacity, pane.id).toBe("0");
  }
  await stepClock(page, 160);
  for (const pane of await visibleContent(page)) {
    expect(pane.runtime, pane.id).toBe("frozen");
    expect(pane.inert, pane.id).toBe(true);
    expect(pane.pointerEvents, pane.id).toBe("none");
  }
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await stepClock(page, 160);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.focusPane("pane-2"),
  );
  await stepClock(page, 160);
  const restored = await visibleContent(page);
  expect(restored.length).toBeGreaterThan(1);
  for (const pane of restored) {
    expect(pane.runtime, pane.id).toBe("live");
    expect(pane.inert, pane.id).toBe(false);
    expect(pane.visibility, pane.id).toBe("visible");
  }
  await expect(field).toHaveValue("Preserved browser state");
  const documentAfter = await page
    .locator('[data-onirigiri-pane-id="pane-2"] iframe')
    .evaluate(
      (element) =>
        (element as HTMLIFrameElement).contentWindow!.performance.timeOrigin,
    );
  expect(documentAfter).toBe(documentBefore);
  await page.screenshot({ path: info.outputPath("native-live-restored.png") });
});

test("native motion begins with identical iframe pixels at the same camera pose", async ({
  page,
}, info) => {
  await openNativeFixture(page);
  const frame = page.locator('[data-onirigiri-pane-id="pane-2"] iframe');
  await expect(
    page
      .frameLocator('[data-onirigiri-pane-id="pane-2"] iframe')
      .getByRole("heading"),
  ).toBeVisible();
  await expect(page.locator('[data-onirigiri-pane-id="pane-2"]')).toHaveCSS(
    "opacity",
    "1",
  );
  await expect(
    page.locator('[data-onirigiri-pane-id="pane-2"] canvas[layoutsubtree]'),
  ).toHaveAttribute("data-onirigiri-native-active", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const capture =
          window.__nativeMotionFixture.handle.current!.getCaptureStatus();
        return (
          capture.inFlightPaneIds.length === 0 &&
          capture.pictures.some((picture) => picture.paneId === "pane-2")
        );
      }),
    )
    .toBe(true);
  await holdClock(page);
  const bounds = await frame.boundingBox();
  expect(bounds).not.toBeNull();
  const clip = {
    x: Math.ceil(bounds!.x) + 64,
    y: Math.ceil(bounds!.y) + 4,
    width: 250,
    height: 180,
  };
  const before = await page.screenshot({
    path: info.outputPath("native-same-pose-rest.png"),
    clip,
  });
  const beforeGeometry = await nativeGeometry(page);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.setFocusAnchor("start"),
  );
  await expect(
    page.locator('[data-onirigiri-pane-id="pane-2"]'),
  ).toHaveAttribute("data-moving", "true");
  expect(await frame.boundingBox()).toEqual(bounds);
  const moving = await page.screenshot({
    path: info.outputPath("native-same-pose-motion.png"),
    clip,
  });
  await info.attach("native-geometry", {
    body: JSON.stringify(
      { before: beforeGeometry, moving: await nativeGeometry(page) },
      null,
      2,
    ),
    contentType: "application/json",
  });
  const changed = await page.evaluate(
    async ({ before, moving }) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${base64}`)).blob(),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const left = await decode(before);
      const right = await decode(moving);
      let differences = 0;
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) differences += 1;
      }
      return differences;
    },
    { before: before.toString("base64"), moving: moving.toString("base64") },
  );
  expect(changed).toBe(0);
});

test("a real supplied frame survives URL revocation and native eviction without changing motion pixels", async ({
  page,
}, info) => {
  await openNativeFixture(page, false, true);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.focusPane("pane-2"),
  );
  const pane = page.locator('[data-onirigiri-pane-id="pane-2"]');
  const frame = pane.locator("iframe");
  await expect(pane).toHaveAttribute("data-moving", "false");
  await expect(
    page
      .frameLocator('[data-onirigiri-pane-id="pane-2"] iframe')
      .getByRole("heading"),
  ).toBeVisible();
  const bounds = (await frame.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
  const captured = await page.screenshot({
    path: info.outputPath("picture-source.png"),
    clip: bounds,
  });
  const clip = { x: bounds.x + 64, y: bounds.y + 4, width: 250, height: 180 };
  const live = await page.screenshot({
    path: info.outputPath("picture-live.png"),
    clip,
  });
  const url = await page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const url = URL.createObjectURL(blob);
    await window.__nativeMotionFixture.supplyPicture("pane-2", url);
    return url;
  }, captured.toString("base64"));
  await expect(pane).toHaveAttribute("data-onirigiri-picture-ready", "true");
  await page.evaluate((url) => URL.revokeObjectURL(url), url);
  const releaseClock = await holdClock(page);
  try {
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.setFocusAnchor("start"),
    );
    await expect(pane).toHaveAttribute("data-moving", "true");
    expect(await frame.boundingBox()).toEqual(bounds);
    const motion = await page.screenshot({
      path: info.outputPath("picture-motion.png"),
      clip,
    });
    expect(await pixelDifferences(page, live, motion)).toBe(0);
    await stepClock(page, 160);
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-10"),
    );
    await stepClock(page, 160);
    await expect(pane).toHaveAttribute("data-visible", "false");
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.toggleOverview(),
    );
    await stepClock(page, 160);
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-2"),
    );
    await stepClock(page, 160);
    await expect(pane).toHaveAttribute("data-moving", "false");
    await expect(frame).toHaveCount(0);
    await expect(pane.locator(".onirigiri-pane__content")).toHaveAttribute(
      "data-onirigiri-placeholder-only",
      "true",
    );
    const picture = pane.locator('[data-onirigiri-slot="pane-picture"]');
    await expect(picture).toHaveCSS("opacity", "1");
    await expect(picture).toBeVisible();
    await expect(picture).toHaveAttribute(
      "data-onirigiri-picture-pixelated",
      "false",
    );
    const retained = await picturePixels(page, picture);
    await info.attach("retained-picture", {
      body: Buffer.from(retained, "base64"),
      contentType: "image/png",
    });
    expect(
      await pixelDifferences(page, captured, Buffer.from(retained, "base64")),
    ).toBe(0);
    await page.screenshot({
      path: info.outputPath("picture-cold-overview-rest.png"),
    });
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.toggleOverview(),
    );
    await stepClock(page, 160);
    await expect(frame).toBeVisible();
    await expect(
      pane.locator(".onirigiri-pane__live-content"),
    ).not.toHaveAttribute("inert");
    const field = page
      .frameLocator('[data-onirigiri-pane-id="pane-2"] iframe')
      .getByRole("textbox");
    await field.click();
    await field.fill("Usable beneath a retained picture");
    await expect(field).toHaveValue("Usable beneath a retained picture");
    for (const visible of await visibleContent(page)) {
      expect(visible.runtime, visible.id).toBe("live");
      expect(visible.inert, visible.id).toBe(false);
    }
  } finally {
    await releaseClock();
  }
});

async function pixelDifferences(
  page: Page,
  before: Buffer,
  after: Buffer,
): Promise<number> {
  return page.evaluate(
    async ({ before, after }) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${base64}`)).blob(),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const left = await decode(before);
      const right = await decode(after);
      if (left.length !== right.length)
        return Math.max(left.length, right.length);
      return left.reduce(
        (changed, channel, index) => changed + Number(channel !== right[index]),
        0,
      );
    },
    { before: before.toString("base64"), after: after.toString("base64") },
  );
}

async function observedWork(page: Page) {
  const visible = await visibleContent(page);
  return Promise.all(
    visible
      .filter((pane) => pane.mounted)
      .map(async (pane) => {
        const element = await page
          .locator(`[data-onirigiri-pane-id="${pane.id}"] iframe`)
          .elementHandle();
        const frame = (await element!.contentFrame())!;
        await frame.waitForFunction(() => window.__nativeContentWork);
        return {
          id: pane.id,
          ...(await frame.evaluate(() =>
            window.__nativeContentWork.snapshot(),
          )),
        };
      }),
  );
}

test("cooperative iframe work stops during motion and overview and all visible work resumes", async ({
  page,
}) => {
  await openNativeFixture(page, false, false, {
    cooperative: true,
    preloadMargin: 0,
  });
  await expect
    .poll(async () => (await observedWork(page)).every((work) => work.running))
    .toBe(true);
  const before = await observedWork(page);
  expect(before.length).toBeGreaterThan(1);
  await expect
    .poll(async () =>
      (await observedWork(page)).every(
        (work) =>
          work.ticks > before.find((item) => item.id === work.id)!.ticks,
      ),
    )
    .toBe(true);
  await holdClock(page);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect(
    page.locator('[data-onirigiri-pane-id="pane-2"]'),
  ).toHaveAttribute("data-moving", "true");
  await expect
    .poll(async () => (await observedWork(page)).every((work) => !work.running))
    .toBe(true);
  const moving = await observedWork(page);
  await page.waitForTimeout(400);
  expect(await observedWork(page)).toEqual(moving);
  await stepClock(page, 160);
  await expect
    .poll(async () => (await observedWork(page)).every((work) => !work.running))
    .toBe(true);
  const overview = await observedWork(page);
  expect(overview.length).toBeGreaterThan(1);
  await page.waitForTimeout(400);
  expect(await observedWork(page)).toEqual(overview);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await stepClock(page, 160);
  await expect
    .poll(async () => (await observedWork(page)).every((work) => work.running))
    .toBe(true);
  const restored = await observedWork(page);
  expect(restored.length).toBeGreaterThan(1);
  await expect
    .poll(async () =>
      (await observedWork(page)).every(
        (work) =>
          work.ticks > restored.find((item) => item.id === work.id)!.ticks,
      ),
    )
    .toBe(true);
  for (const pane of await visibleContent(page)) {
    expect(pane.runtime, pane.id).toBe("live");
    expect(pane.inert, pane.id).toBe(false);
  }
});

test("large viewports paint every loaded same-origin frame", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 6016, height: 3384 });
  await openNativeFixture(page, true);
  expect(await page.evaluate(() => devicePixelRatio)).toBe(1);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.focusPane("pane-69"),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const snapshot =
          window.__nativeMotionFixture.handle.current!.getSnapshot();
        return (
          snapshot.scrollColumn === snapshot.targetScrollColumn &&
          snapshot.scrollRow === snapshot.targetScrollRow &&
          snapshot.horizontalAnchorOffset ===
            snapshot.targetHorizontalAnchorOffset
        );
      }),
    )
    .toBe(true);
  await expect.poll(() => page.locator('[data-moving="true"]').count()).toBe(0);
  const frames = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLIFrameElement>("iframe")]
      .map((frame) => ({
        id: frame.closest<HTMLElement>(".onirigiri-pane")!.dataset
          .onirigiriPaneId!,
        box: frame.getBoundingClientRect().toJSON() as {
          x: number;
          y: number;
          width: number;
          height: number;
        },
      }))
      .filter(
        ({ box }) =>
          box.width > 450 &&
          box.height > 100 &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= innerWidth &&
          box.y + box.height <= innerHeight,
      ),
  );
  expect(frames.length).toBeGreaterThan(50);
  for (const { id } of frames) {
    await expect(
      page
        .frameLocator(`[data-onirigiri-pane-id="${id}"] iframe`)
        .locator("h1"),
    ).toHaveText("Retained native frame");
    await expect(
      page.locator(
        `[data-onirigiri-pane-id="${id}"] [data-onirigiri-slot="pane-live-content"]`,
      ),
    ).toHaveAttribute("data-onirigiri-live", "true");
  }
  let painted: { id: string; ink: number }[] = [];
  await expect(async () => {
    painted = await framePaint(page, frames, info);
    expect(painted.filter(({ ink }) => ink < 100)).toEqual([]);
  }).toPass({ timeout: 10_000 });
  await info.attach("large-native-frame-paint", {
    body: JSON.stringify(painted),
    contentType: "application/json",
  });
});

async function framePaint(
  page: Page,
  frames: { id: string; box: { x: number; y: number } }[],
  info: TestInfo,
): Promise<{ id: string; ink: number }[]> {
  const screenshot = await page.screenshot({
    path: info.outputPath("large-native-frame-paint.png"),
  });
  return page.evaluate(
    async ({ frames, base64 }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${base64}`)).blob(),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const painted = frames.map(({ id, box }) => {
        const pixels = context.getImageData(
          Math.ceil(box.x) + 16,
          Math.ceil(box.y) + 20,
          430,
          50,
        ).data;
        let ink = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            pixels[index]! > 100 &&
            pixels[index + 1]! > 80 &&
            pixels[index + 2]! < 120
          )
            ink += 1;
        }
        return { id, ink };
      });
      canvas.width = canvas.height = 0;
      return painted;
    },
    { frames, base64: screenshot.toString("base64") },
  );
}

test("retains sharp mosaics when new full-size pictures exceed the cache budget", async ({
  page,
}) => {
  await openNativeFixture(page, false, true, {
    rasterBudgetBytes: 70000,
    budgetBytes: 0,
    preloadMargin: 0,
  });
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect(page.locator(".onirigiri-workspace")).toHaveAttribute(
    "data-presentation-mode",
    "overview",
  );
  await page.waitForFunction(
    () =>
      window.__nativeMotionFixture.handle.current!.getCaptureStatus()
        .inFlightPaneIds.length === 0,
  );
  await page.evaluate(async () => {
    window.__nativeMotionFixture.setPictureBudget(256 * 1024 * 1024);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext("2d")!;
    for (let y = 0; y < canvas.height; y += 16) {
      for (let x = 0; x < canvas.width; x += 16) {
        context.fillStyle = (x + y) % 32 === 0 ? "#ff0000" : "#0000ff";
        context.fillRect(x, y, 16, 16);
      }
    }
    const source = canvas.toDataURL("image/png");
    await window.__nativeMotionFixture.supplyPictures([
      ["pane-5", source],
      ["pane-6", source],
    ]);
  });
  const pictures = page.locator(".onirigiri-pane__picture");
  await expect(pictures).toHaveCount(2);
  for (const paneId of ["pane-5", "pane-6", "pane-5"]) {
    await page.evaluate(
      (id) => window.__nativeMotionFixture.handle.current!.focusPane(id),
      paneId,
    );
    const picture = page.locator(
      `[data-onirigiri-pane-id="${paneId}"] canvas.onirigiri-pane__picture`,
    );
    await expect(picture).toHaveCSS("image-rendering", "pixelated");
    const pixels = await page.evaluate(
      async (base64) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${base64}`)).blob(),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const colors = new Set<string>();
        for (let index = 0; index < data.length; index += 4)
          colors.add(
            `${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`,
          );
        const result = {
          width: bitmap.width,
          height: bitmap.height,
          colors: [...colors].sort(),
        };
        bitmap.close();
        return result;
      },
      await picturePixels(page, picture),
    );
    expect(pixels).toEqual({
      width: 128,
      height: 64,
      colors: ["0,0,255,255", "255,0,0,255"],
    });
    await expect(pictures).toHaveCount(2);
  }
});

test("viewport zoom pauses picture acquisition and restores it without replacing content", async ({
  page,
}) => {
  await openNativeFixture(page, false, false, { count: 4, preloadMargin: 0 });
  const input = page
    .frameLocator('[data-onirigiri-pane-id="pane-1"] iframe')
    .getByRole("textbox");
  await input.fill("Retain through viewport changes");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__nativeMotionFixture.handle.current!.getCaptureStatus()
            .accepted,
      ),
    )
    .toBeGreaterThan(0);
  const original = await page.evaluateHandle(
    () =>
      document.querySelector<HTMLIFrameElement>(
        '[data-onirigiri-pane-id="pane-1"] iframe',
      )!.contentDocument,
  );
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await page.waitForFunction(() => visualViewport?.scale === 2);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const blocked = await page.evaluate(() => {
      const handle = window.__nativeMotionFixture.handle.current!;
      handle.refreshPanePictures();
      return handle.getCaptureStatus().accepted;
    });
    await page.waitForTimeout(350);
    expect(
      await page.evaluate(
        () =>
          window.__nativeMotionFixture.handle.current!.getCaptureStatus()
            .accepted,
      ),
    ).toBe(blocked);
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__nativeMotionFixture.handle.current!.getCaptureStatus()
              .accepted,
        ),
      )
      .toBeGreaterThan(blocked);
    await expect(input).toHaveValue("Retain through viewport changes");
    expect(
      await page.evaluate(
        (document) =>
          document ===
          window.document.querySelector<HTMLIFrameElement>(
            '[data-onirigiri-pane-id="pane-1"] iframe',
          )!.contentDocument,
        original,
      ),
    ).toBe(true);
  } finally {
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await session.detach();
    await original.dispose();
  }
});

test("background pictures stagger one temporary offscreen document and retain its pixels after unloading", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    const trace: Window["__backgroundCaptureTrace"] = {
      maximumColdDocuments: 0,
      warmups: [],
    };
    window.__backgroundCaptureTrace = trace;
    let previous: string | null = null;
    const observe = () => {
      const handle = window.__nativeMotionFixture?.handle.current;
      if (handle) {
        const status = handle.getCaptureStatus();
        const current = status.preloadingPaneId;
        if (current !== previous) {
          if (previous) trace.warmups.at(-1)!.end = performance.now();
          if (current)
            trace.warmups.push({
              id: current,
              start: performance.now(),
              end: null,
            });
          previous = current;
        }
        const stage = document
          .querySelector('[data-onirigiri-slot="stage"]')!
          .getBoundingClientRect();
        const cold = [...document.querySelectorAll("iframe")].filter(
          (frame) => {
            const bounds = frame
              .closest('[data-onirigiri-slot="pane"]')!
              .getBoundingClientRect();
            return (
              bounds.right <= stage.left ||
              bounds.left >= stage.right ||
              bounds.bottom <= stage.top ||
              bounds.top >= stage.bottom
            );
          },
        );
        trace.maximumColdDocuments = Math.max(
          trace.maximumColdDocuments,
          cold.length,
        );
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  await openNativeFixture(page, false, false, {
    count: 10,
    cooperative: true,
    allPictures: true,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__nativeMotionFixture.handle.current!.getCaptureStatus()
              .pictures.length,
        ),
      { timeout: 25_000 },
    )
    .toBe(10);
  await expect(page.locator('[data-onirigiri-preloading="true"]')).toHaveCount(
    0,
  );
  const trace = await page.evaluate(() => window.__backgroundCaptureTrace);
  expect(trace.maximumColdDocuments).toBe(1);
  expect(trace.warmups.length).toBeGreaterThan(2);
  for (let index = 1; index < trace.warmups.length; index++) {
    expect(trace.warmups[index - 1]!.end).not.toBeNull();
    expect(
      trace.warmups[index]!.start - trace.warmups[index - 1]!.end!,
    ).toBeGreaterThanOrEqual(0);
  }
  const last = trace.warmups.at(-1)!.id;
  const pane = page.locator(`[data-onirigiri-pane-id="${last}"]`);
  await expect(pane.locator("iframe")).toHaveCount(0);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await page.evaluate(
    (id) => window.__nativeMotionFixture.handle.current!.focusPane(id),
    last,
  );
  await expect(pane).toHaveAttribute("data-moving", "false");
  const image = pane.locator('[data-onirigiri-slot="pane-picture"]');
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(1);
  expect(
    await page.evaluate(
      async (base64) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${base64}`)).blob(),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          bitmap.width,
          bitmap.height,
        ).data;
        bitmap.close();
        const colors = new Set<string>();
        for (let index = 0; index < pixels.length; index += 4)
          colors.add(
            `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`,
          );
        return colors.has("8,59,75,255") && colors.has("244,207,96,255");
      },
      await picturePixels(page, image),
    ),
  ).toBe(true);
  await page.waitForTimeout(600);
  await expect(pane.locator("iframe")).toHaveCount(0);
  await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.toggleOverview(),
  );
  await expect
    .poll(async () => (await observedWork(page)).every((work) => work.running))
    .toBe(true);
});

test("compressed originals restore focused detail during motion within a bounded texture cache", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await openNativeFixture(page, false, false, {
    count: 20,
    allPictures: true,
    rasterBudgetBytes: 12 * 1024 * 1024,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__nativeMotionFixture.handle.current!.getCaptureStatus()
              .pictures.length,
        ),
      { timeout: 25_000 },
    )
    .toBe(20);
  const before = await page.evaluate(() =>
    window.__nativeMotionFixture.handle.current!.getCaptureStatus(),
  );
  expect(before.pictureRasterBytes).toBeLessThanOrEqual(12 * 1024 * 1024);
  const original = before.pictures.find(
    (picture) => picture.paneId === "pane-20",
  )!;
  expect(original.pixelated).toBe(true);
  const releaseClock = await holdClock(page);
  try {
    await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.focusPane("pane-20"),
    );
    await stepClock(page, 1);
    const pane = page.locator('[data-onirigiri-pane-id="pane-20"]');
    await expect(pane).toHaveAttribute("data-moving", "true");
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__nativeMotionFixture.handle
                .current!.getCaptureStatus()
                .pictures.find((picture) => picture.paneId === "pane-20")
                ?.pixelated,
          ),
        { intervals: [10], timeout: 250 },
      )
      .toBe(false);
    const after = await page.evaluate(() =>
      window.__nativeMotionFixture.handle.current!.getCaptureStatus(),
    );
    const restored = after.pictures.find(
      (picture) => picture.paneId === "pane-20",
    )!;
    expect(restored.revision).toBe(original.revision);
    expect(restored.capture).toEqual(original.capture);
    expect(restored.width).toBeGreaterThan(original.width);
    expect(after.accepted).toBe(before.accepted);
    expect(after.pictureRasterBytes).toBeLessThanOrEqual(12 * 1024 * 1024);
    await expect(pane).toHaveAttribute("data-moving", "true");
  } finally {
    await releaseClock();
  }
});
