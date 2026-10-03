import { expect, test } from "@playwright/test";
import { build, preview } from "vite";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { browserGraphicsCapabilities } from "../performance/browser-environment";
import {
  expectPlaygroundCadence,
  playgroundCadence,
  playgroundCensus,
  waitForPlaygroundContent,
} from "./playground-overview-probe";
import { chromeLaunchOptions } from "./chrome-launch";

test.use({ trace: "off" });

const repositoryRoot = new URL("../../", import.meta.url).pathname;

test("native live panes sustain cadence in the production playground and overview", async ({
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const temporaryRoot = join(repositoryRoot, "tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const outDir = await mkdtemp(join(temporaryRoot, "overview-guard-"));
  const configFile = join(
    repositoryRoot,
    "playground/two-dimensional/vite.config.ts",
  );
  await build({ configFile, build: { outDir }, logLevel: "error" });
  const server = await preview({
    configFile,
    build: { outDir },
    preview: { host: "127.0.0.1", port: 4212, strictPort: true, open: false },
    logLevel: "error",
  });
  const browser = await playwright.chromium.launch({
    ...chromeLaunchOptions,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1536, height: 930 },
    deviceScaleFactor: 2,
  });
  const errors: string[] = [];
  const measurements: Record<
    string,
    Awaited<ReturnType<typeof playgroundCadence>>
  > = {};
  const environment: Record<string, unknown> = {
    browser: browser.version(),
    viewport: page.viewportSize(),
    deviceScaleFactor: 2,
  };
  const measure = (phase: string, moving = false) =>
    test.step(phase, async () => {
      const sample = await playgroundCadence(page, moving);
      measurements[phase] = sample;
      expectPlaygroundCadence(sample);
      return sample;
    });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const lab = { cwd: join(repositoryRoot, "../browser-surface-lab") };
    environment.labRevision = execFileSync("git", ["rev-parse", "HEAD"], lab)
      .toString()
      .trim();
    environment.labChanges = execFileSync("git", ["status", "--short"], lab)
      .toString()
      .trim();
    const session = await browser.newBrowserCDPSession();
    const system = await session.send("SystemInfo.getInfo");
    environment.gpu = system.gpu;
    await session.detach();
    const capabilities = await browserGraphicsCapabilities(page);
    environment.capabilities = capabilities;
    expect(
      capabilities.missing,
      "Required playground graphics capabilities",
    ).toEqual([]);
    await measure("blank");
    await page.goto("http://127.0.0.1:4212/");
    await expect(page.locator('[data-onirigiri-slot="pane"]')).toHaveCount(100);
    await waitForPlaygroundContent(page);
    for (const key of [
      ...Array<string>(6).fill("Right"),
      ...Array<string>(4).fill("Down"),
    ]) {
      await page.keyboard.press(`Alt+Arrow${key}`);
      await page.waitForTimeout(200);
    }
    await expect(
      page.locator('[data-onirigiri-pane-id="pane-47"]'),
    ).toHaveAttribute("data-focused", "true");
    await waitForPlaygroundContent(page);
    environment.focused = await playgroundCensus(page);
    await measure("focused");
    await measure("navigation", true);
    await page
      .getByRole("button", {
        name: "Zoom out to workspace overview",
        exact: true,
      })
      .click();
    await waitForPlaygroundContent(page);
    const sceneFrames = page.locator(
      '[data-visible="true"] iframe[src*="fixture=three-"]',
    );
    await expect(sceneFrames).toHaveCount(4);
    const scenes = (await sceneFrames.all()).map((frame) =>
      frame.contentFrame().locator(".three-viewport canvas[aria-label]"),
    );
    for (const scene of scenes) await expect(scene).toBeVisible();
    environment.overview = await playgroundCensus(page);
    environment.assets = await page.evaluate(() => {
      const windows = [
        window,
        ...[...document.querySelectorAll("iframe")].flatMap((frame) =>
          frame.contentWindow ? [frame.contentWindow] : [],
        ),
      ];
      return [
        ...new Set(
          windows.flatMap((frame) =>
            frame.performance
              .getEntriesByType("resource")
              .map((entry) => new URL(entry.name).pathname),
          ),
        ),
      ]
        .filter((path) => /\.(js|css|webm)$/.test(path))
        .sort();
    });
    const before = await Promise.all(scenes.map((scene) => scene.screenshot()));
    const still = await measure("still");
    expect.soft(still.scenes).toHaveLength(4);
    for (const scene of still.scenes) {
      expect.soft(scene.connected).toBe(true);
      expect.soft(scene.frames).toBeGreaterThanOrEqual(still.frames - 2);
    }
    expect.soft(still.videos).toHaveLength(2);
    for (const video of still.videos) {
      expect.soft(video.paused).toBe(false);
      expect.soft(video.renderer).toBe("canvas");
      expect.soft(video.frames).toBeGreaterThanOrEqual(140);
    }
    for (let index = 0; index < before.length; index++)
      expect
        .soft((await scenes[index]!.screenshot()).equals(before[index]!))
        .toBe(false);
    await measure("moving", true);
    expect(errors).toEqual([]);
  } finally {
    try {
      const path = info.outputPath("production-playground-overview.json");
      await writeFile(
        path,
        JSON.stringify({ environment, measurements, errors }),
      );
      await info.attach("production-playground-overview", {
        path,
        contentType: "application/json",
      });
      await cp(outDir, info.outputPath("production-assets"), {
        recursive: true,
      });
    } finally {
      await Promise.all([browser.close(), server.close()]);
      await rm(outDir, { recursive: true, force: true });
    }
  }
});
