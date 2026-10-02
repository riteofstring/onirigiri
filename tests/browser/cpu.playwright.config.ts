import { defineConfig } from "@playwright/test";
import { chromeLaunchOptions } from "./chrome-launch";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.cpu.pw.ts",
  outputDir: "../../tmp/cpu-playwright-results",
  preserveOutput: "always",
  reporter: "line",
  workers: 1,
  use: {
    headless: true,
    launchOptions: chromeLaunchOptions,
    trace: "off",
  },
});
