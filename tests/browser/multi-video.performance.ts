import { writeFile } from "node:fs/promises";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { maximum60HzMeanFrameMs } from "../performance/frame-budget";
import { chromeLaunchOptions } from "./chrome-launch";

test.use({ headless: true, viewport: { width: 1440, height: 900 } });

test.describe("simultaneous native videos in headless Chrome", () => {
  for (const deviceScaleFactor of [1, 2]) {
    test(`multi-video preserves 60Hz at desktop${deviceScaleFactor === 2 ? "-retina" : ""}`, async ({
      browser,
      playwright,
    }, testInfo) => {
      const page = await browser.newPage({
        deviceScaleFactor,
        viewport: { width: 1440, height: 900 },
      });
      try {
        await page.waitForTimeout(2000);
        const baseline = await measureVideoCadence(page);
        await retainSample(testInfo, `blank-${deviceScaleFactor}x`, baseline);
        expect(baseline.headless).toBe(true);
        expect(baseline.visibility).toBe("visible");
        expect(baseline.videos).toHaveLength(0);
        expect
          .soft(baseline.meanFrameMs, "blank browser baseline")
          .toBeLessThanOrEqual(maximum60HzMeanFrameMs);
        for (const container of ["plain", "workspace"] as const) {
          for (const videos of [1, 2]) {
            const cadenceRequired = container === "workspace" || videos === 1;
            const isolated = await playwright.chromium.launch({
              ...chromeLaunchOptions,
              headless: true,
            });
            const page = await isolated.newPage({
              baseURL: testInfo.project.use.baseURL,
              deviceScaleFactor,
              viewport: { width: 1440, height: 900 },
            });
            try {
              await page.goto(
                `/?scenario=multi-video&container=${container}&videos=${videos}`,
              );
              await expect(
                page.locator("[data-production=true]"),
              ).toBeVisible();
              await expect(page.locator("video")).toHaveCount(videos);
              if (container === "workspace") {
                await expect(
                  page.locator("[data-onirigiri-live=true]"),
                ).toHaveCount(videos);
                await expect(
                  page.locator(
                    '[data-onirigiri-renderer="dom"][data-onirigiri-presentation-live="true"]',
                  ),
                ).toHaveCount(videos);
                await expect(
                  page.locator('video[data-onirigiri-video-renderer="canvas"]'),
                ).toHaveCount(videos);
              }
              await expect
                .poll(() =>
                  page
                    .locator("video")
                    .evaluateAll((elements) =>
                      elements.every(
                        (video) =>
                          video instanceof HTMLVideoElement &&
                          !video.paused &&
                          video.readyState >= 3 &&
                          video.currentTime > 0.5,
                      ),
                    ),
                )
                .toBe(true);
              await page.waitForTimeout(2000);
              const sample = await measureVideoCadence(page);
              const name = `${container}-${videos}-videos-${deviceScaleFactor}x`;
              await retainSample(testInfo, name, sample);
              expect(sample.headless).toBe(true);
              expect(sample.visibility).toBe("visible");
              expect(sample.videos).toHaveLength(videos);
              for (const video of sample.videos) {
                expect(video.visible).toBe(true);
                expect(video.paused).toBe(false);
                expect(video.playbackRate).toBe(1);
                expect(video.width).toBe(1280);
                expect(video.height).toBe(720);
                if (cadenceRequired)
                  expect(video.callbacks).toBeGreaterThanOrEqual(90);
                expect(video.presentedFrames).toBeGreaterThanOrEqual(90);
                expect(video.maximumGapMs).toBeLessThan(250);
                expect(video.mediaFramesPerSecond).toBeGreaterThanOrEqual(29);
                expect(video.mediaFramesPerSecond).toBeLessThanOrEqual(31);
              }
              const pixels = await page.locator("video").all();
              const before = await Promise.all(
                pixels.map((video) => video.screenshot()),
              );
              await page.waitForTimeout(500);
              for (const [index, video] of pixels.entries())
                expect((await video.screenshot()).equals(before[index]!)).toBe(
                  false,
                );
              if (cadenceRequired)
                expect
                  .soft(sample.meanFrameMs, `${name} display cadence`)
                  .toBeLessThanOrEqual(maximum60HzMeanFrameMs);
            } finally {
              await isolated.close();
            }
          }
        }
      } finally {
        await page.close();
      }
    });
  }
});

async function retainSample(testInfo: TestInfo, name: string, sample: unknown) {
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(sample, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
}

async function measureVideoCadence(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        frameDeltasMs: number[];
        headless: boolean;
        meanFrameMs: number;
        videos: {
          callbacks: number;
          height: number;
          maximumGapMs: number;
          mediaFramesPerSecond: number;
          paused: boolean;
          playbackRate: number;
          presentedFrames: number;
          visible: boolean;
          width: number;
        }[];
        visibility: DocumentVisibilityState;
      }>((resolve, reject) => {
        const videos = [...document.querySelectorAll("video")];
        const counters = videos.map(() => ({
          callbacks: 0,
          first: 0,
          last: 0,
          firstMediaTime: 0,
          lastMediaTime: 0,
          previous: performance.now(),
          maximumGapMs: 0,
        }));
        const requests = videos.map((video, index) => {
          const observe: VideoFrameRequestCallback = (now, metadata) => {
            const counter = counters[index]!;
            counter.callbacks += 1;
            if (counter.callbacks === 1) {
              counter.first = metadata.presentedFrames;
              counter.firstMediaTime = metadata.mediaTime;
            }
            counter.last = metadata.presentedFrames;
            counter.lastMediaTime = metadata.mediaTime;
            counter.maximumGapMs = Math.max(
              counter.maximumGapMs,
              now - counter.previous,
            );
            counter.previous = now;
            requests[index] = video.requestVideoFrameCallback(observe);
          };
          return video.requestVideoFrameCallback(observe);
        });
        const frameDeltasMs: number[] = [];
        let first: number | undefined;
        let previous: number | undefined;
        let frame = 0;
        const finish = () => {
          cancelAnimationFrame(frame);
          videos.forEach((video, index) =>
            video.cancelVideoFrameCallback(requests[index]!),
          );
        };
        const deadline = setTimeout(() => {
          finish();
          reject(
            new Error(
              "Visible video measurement did not finish within eight seconds.",
            ),
          );
        }, 8000);
        const sample = (now: number) => {
          first ??= now;
          if (previous !== undefined) frameDeltasMs.push(now - previous);
          previous = now;
          if (now - first < 4000) {
            frame = requestAnimationFrame(sample);
            return;
          }
          clearTimeout(deadline);
          finish();
          resolve({
            frameDeltasMs,
            headless: navigator.userAgent.includes("HeadlessChrome"),
            meanFrameMs:
              frameDeltasMs.reduce((total, delta) => total + delta, 0) /
              frameDeltasMs.length,
            visibility: document.visibilityState,
            videos: videos.map((video, index) => {
              const counter = counters[index]!;
              const rect = video.getBoundingClientRect();
              return {
                callbacks: counter.callbacks,
                height: video.videoHeight,
                maximumGapMs: Math.max(
                  counter.maximumGapMs,
                  performance.now() - counter.previous,
                ),
                mediaFramesPerSecond:
                  (counter.last - counter.first) /
                  ((counter.lastMediaTime -
                    counter.firstMediaTime +
                    video.duration) %
                    video.duration),
                paused: video.paused,
                playbackRate: video.playbackRate,
                presentedFrames: counter.last - counter.first,
                visible:
                  video.checkVisibility() &&
                  rect.left >= 0 &&
                  rect.top >= 0 &&
                  rect.right <= innerWidth &&
                  rect.bottom <= innerHeight,
                width: video.videoWidth,
              };
            }),
          });
        };
        frame = requestAnimationFrame(sample);
      }),
  );
}
