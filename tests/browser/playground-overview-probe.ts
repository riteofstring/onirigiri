import { expect, type Page } from "@playwright/test";

const visiblePanes = '[data-onirigiri-slot="pane"][data-visible="true"]';

export async function waitForPlaygroundContent(page: Page) {
  await expect
    .poll(
      () =>
        page.locator(`${visiblePanes} iframe`).evaluateAll(
          (frames) =>
            frames.length > 0 &&
            frames.every((frame) => {
              const element = frame as HTMLIFrameElement;
              return (
                element.dataset.consumerReady === "true" &&
                element.contentDocument?.readyState === "complete"
              );
            }),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

export function playgroundCensus(page: Page) {
  return page.locator(visiblePanes).evaluateAll((panes) =>
    panes.map((pane) => {
      const element = pane as HTMLElement;
      const box = element.getBoundingClientRect();
      return {
        id: element.dataset.onirigiriPaneId,
        kind: element.dataset.onirigiriSurfaceKind,
        renderer: element.dataset.onirigiriRenderer,
        width: box.width,
        height: box.height,
      };
    }),
  );
}

export async function playgroundCadence(page: Page, moving = false) {
  const sample = await page.evaluateHandle(() => {
    const panes = [
      ...document.querySelectorAll(
        '[data-onirigiri-slot="pane"][data-visible="true"]',
      ),
    ];
    const scenes = panes.flatMap((pane) =>
      [...pane.querySelectorAll("iframe")].flatMap((frame) =>
        [
          ...(frame.contentDocument?.querySelectorAll<HTMLElement>(
            ".three-viewport",
          ) ?? []),
        ].map((element) => ({
          element,
          before: Number(element.dataset.frames),
        })),
      ),
    );
    const videos = panes.flatMap((pane) =>
      [...pane.querySelectorAll("iframe")].flatMap((frame) =>
        [...(frame.contentDocument?.querySelectorAll("video") ?? [])].map(
          (element) => ({
            element,
            before: element.getVideoPlaybackQuality().totalVideoFrames,
          }),
        ),
      ),
    );
    const state = {
      active: true,
      previous: 0,
      deltas: [] as number[],
      scenes,
      videos,
    };
    const tick = (time: number) => {
      if (!state.active) return;
      if (state.previous) state.deltas.push(time - state.previous);
      state.previous = time;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return state;
  });
  try {
    if (moving) {
      for (let cycle = 0; cycle < 10; cycle++) {
        for (const key of ["Right", "Down", "Left", "Up"]) {
          await page.keyboard.press(`Alt+Arrow${key}`);
          await page.waitForTimeout(250);
        }
      }
    } else await page.waitForTimeout(5000);
    return await sample.evaluate((state) => {
      state.active = false;
      const deltas = state.deltas;
      const sorted = [...deltas].sort((a, b) => a - b);
      return {
        frames: deltas.length,
        deltas,
        mean: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
        maximum: Math.max(...deltas),
        p99: sorted[Math.floor(sorted.length * 0.99)]!,
        slowRatio: deltas.filter((delta) => delta > 25).length / deltas.length,
        scenes: state.scenes.map(({ element, before }) => ({
          frames: Number(element.dataset.frames) - before,
          connected: element.isConnected,
        })),
        videos: state.videos.map(({ element, before }) => ({
          frames: element.getVideoPlaybackQuality().totalVideoFrames - before,
          paused: element.paused,
          renderer: element.dataset.onirigiriVideoRenderer,
        })),
      };
    });
  } finally {
    await sample.evaluate((state) => {
      state.active = false;
    });
    await sample.dispose();
  }
}

export function expectPlaygroundCadence(
  sample: Awaited<ReturnType<typeof playgroundCadence>>,
) {
  expect.soft(sample.mean).toBeLessThanOrEqual(1000 / 60 + 0.1);
  expect.soft(sample.maximum).toBeLessThanOrEqual(50);
  expect.soft(sample.p99).toBeLessThanOrEqual(33.4);
  expect.soft(sample.slowRatio).toBeLessThanOrEqual(0.08);
}
