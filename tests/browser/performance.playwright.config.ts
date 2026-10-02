import { defineConfig } from "@playwright/test";
import { chromeLaunchOptions } from "./chrome-launch";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  globalSetup: "./hardware-webgpu.setup.ts",
  outputDir: "../../tmp/performance-playwright-results",
  preserveOutput: "always",
  projects: [
    {
      name: "chrome-production",
      use: { browserName: "chromium" },
    },
  ],
  reporter: "line",
  testDir: ".",
  testMatch: "**/*.performance.ts",
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:4175",
    headless: true,
    launchOptions: chromeLaunchOptions,
    trace: "off",
  },
  webServer: {
    command:
      "pnpm build:performance && pnpm exec vite preview --config bench/vite.config.ts --host 127.0.0.1 --port 4175",
    cwd: repositoryRoot,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
    reuseExistingServer: false,
    timeout: 60_000,
    url: "http://127.0.0.1:4175",
  },
  workers: 1,
});
