import { defineConfig } from "@playwright/test";
import { chromeLaunchOptions } from "./chrome-launch";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  globalSetup: "./hardware-webgpu.setup.ts",
  outputDir: "../../tmp/playwright-results",
  preserveOutput: "always",
  projects: [
    {
      name: "chrome",
      use: {
        baseURL: "http://127.0.0.1:4174",
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
  webServer: {
    command: "pnpm dev:2d --host 127.0.0.1 --port 4174 --open=false",
    cwd: repositoryRoot,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4174",
  },
  workers: 1,
});
