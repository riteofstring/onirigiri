import { expect, test, type Page } from "@playwright/test";

import { startTwoDimensionalDevServer } from "./two-dimensional-dev-server";

const demoContent = "notes,signals,atlas,tasks,mixer,system";

interface PrePaintFrame {
  hiddenOnScreen: string[];
  moving: boolean;
  onScreen: string[];
}

let server: Awaited<ReturnType<typeof startTwoDimensionalDevServer>>;

test.beforeAll(async () => {
  server = await startTwoDimensionalDevServer();
});

test.afterAll(async () => {
  await server?.close();
});

async function installFrameProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    let virtualTime: number | null = null;
    let lastFrame: number | null = null;
    window.requestAnimationFrame = (callback) =>
      request((timestamp) => {
        if (timestamp !== lastFrame) {
          lastFrame = timestamp;
          virtualTime =
            virtualTime === null ? timestamp : virtualTime + 1000 / 60;
        }
        callback(virtualTime ?? timestamp);
      });
  });
}

async function recordPrePaintFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: PrePaintFrame[] = [];
    Reflect.set(window, "__overviewFrames", frames);
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.append(probe);
    const onScreen = (element: Element) => {
      const box = element.getBoundingClientRect();
      return (
        box.right > 0 &&
        box.bottom > 0 &&
        box.left < innerWidth &&
        box.top < innerHeight
      );
    };
    new ResizeObserver(() => {
      const panes = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-onirigiri-slot="pane"]',
        ),
      ].filter((pane) => !pane.hidden && onScreen(pane));
      frames.push({
        hiddenOnScreen: panes
          .filter((pane) => {
            const content = pane.querySelector(".onirigiri-pane__live-content");
            return (
              content !== null &&
              getComputedStyle(content).contentVisibility === "hidden"
            );
          })
          .map((pane) => pane.dataset.onirigiriPaneId ?? ""),
        moving:
          document
            .querySelector('[data-onirigiri-slot="grid-cursor"]')
            ?.getAttribute("data-moving") === "true",
        onScreen: panes.map((pane) => pane.dataset.onirigiriPaneId ?? ""),
      });
    }).observe(probe);
    let wide = false;
    const tick = () => {
      wide = !wide;
      probe.style.width = wide ? "2px" : "1px";
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function departingPanes(frames: readonly PrePaintFrame[]): Set<string> {
  const departing = new Set<string>();
  frames.forEach((frame, index) => {
    if (!frame.moving || frames[index - 1]?.moving !== false) return;
    const settled = frames.slice(index).find((later) => !later.moving);
    for (const paneId of frame.onScreen)
      if (settled && !settled.onScreen.includes(paneId)) departing.add(paneId);
  });
  return departing;
}

async function waitForCursorToSettle(page: Page): Promise<void> {
  await expect(
    page.locator('[data-onirigiri-slot="grid-cursor"]'),
  ).toHaveAttribute("data-moving", "false");
  await page.waitForTimeout(150);
}

test("overview camera moves keep every on-screen pane's content rendered", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ height: 900, width: 1440 });
  await installFrameProbe(page);
  await page.goto(`${server.origin}/?count=50&content=${demoContent}`);
  await expect(page.locator('[data-onirigiri-slot="pane"]')).toHaveCount(50);
  const workspace = page.locator('[data-onirigiri-slot="workspace"]');
  await workspace.focus();
  await page.keyboard.press("Alt+o");
  await expect(workspace).toHaveAttribute("data-presentation-mode", "overview");
  await waitForCursorToSettle(page);
  await recordPrePaintFrames(page);

  for (const direction of ["Right", "Right", "Down", "Left", "Up"]) {
    await page.keyboard.press(`Alt+Arrow${direction}`);
    await waitForCursorToSettle(page);
  }

  const frames = await page.evaluate(
    () => Reflect.get(window, "__overviewFrames") as PrePaintFrame[],
  );
  const motionFrames = frames.filter((frame) => frame.moving);
  expect(motionFrames.length).toBeGreaterThan(20);
  const departing = departingPanes(frames);
  expect(departing.size).toBeGreaterThan(0);
  expect(
    frames.flatMap((frame, index) =>
      frame.hiddenOnScreen.map((paneId) => `frame ${index}: ${paneId}`),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
