import { defineConfig } from "@playwright/test";
import { chromeLaunchOptions } from "./chrome-launch";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

const oneDimensionalSuites = "**/one-dimensional-*.pw.ts";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  globalSetup: "./hardware-webgpu.setup.ts",
  outputDir: "../../tmp/playwright-results",
  preserveOutput: "always",
  projects: [
    {
      name: "chrome",
      testIgnore: [oneDimensionalSuites],
      use: {
        baseURL: "http://127.0.0.1:4174",
        browserName: "chromium",
      },
    },
    {
      name: "chrome-one-dimensional",
      testMatch: oneDimensionalSuites,
      timeout: 60_000,
      use: {
        baseURL: "http://127.0.0.1:4173",
        browserName: "chromium",
      },
    },
  ],
  reporter: "line",
  testDir: ".",
  testMatch: "**/*.pw.ts",
  timeout: 20_000,
  use: {
    headless: true,
    launchOptions: chromeLaunchOptions,
    trace: "retain-on-failure",
    viewport: { height: 900, width: 1_280 },
  },
  webServer: [
    {
      command:
        "node scripts/playground-server.mjs dev:1d --host 127.0.0.1 --port 4173 --open=false",
      cwd: repositoryRoot,
      gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:4173",
    },
    {
      command:
        "node scripts/playground-server.mjs dev:2d --host 127.0.0.1 --port 4174 --open=false",
      cwd: repositoryRoot,
      gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:4174",
    },
  ],
  workers: 1,
});
