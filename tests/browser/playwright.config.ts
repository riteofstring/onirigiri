import { defineConfig } from "@playwright/test";
import { chromeLaunchOptions } from "./chrome-launch";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

const oneDimensionalSuites = "**/one-dimensional-*.pw.ts";
const nativeCadenceSuite = "**/pane-native-cadence.pw.ts";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  globalSetup: "./hardware-webgpu.setup.ts",
  outputDir: "../../tmp/playwright-results",
  preserveOutput: "always",
  projects: [
    {
      name: "chrome",
      testIgnore: [oneDimensionalSuites, nativeCadenceSuite],
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
    {
      name: "chrome-native-cadence",
      testMatch: nativeCadenceSuite,
      use: {
        baseURL: "http://127.0.0.1:4176",
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
      command: "pnpm dev:1d --host 127.0.0.1 --port 4173 --open=false",
      cwd: repositoryRoot,
      env: { NODE_ENV: "development" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:4173",
    },
    {
      command: "pnpm dev:2d --host 127.0.0.1 --port 4174 --open=false",
      cwd: repositoryRoot,
      env: { NODE_ENV: "development" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:4174",
    },
    {
      command:
        "pnpm exec vite build --config tests/browser/cadence.vite.config.ts && pnpm exec vite preview --config tests/browser/cadence.vite.config.ts --host 127.0.0.1 --port 4176",
      cwd: repositoryRoot,
      env: { NODE_ENV: "production" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
      reuseExistingServer: false,
      timeout: 60_000,
      url: "http://127.0.0.1:4176/native-content-guard.html",
    },
  ],
  workers: 1,
});
