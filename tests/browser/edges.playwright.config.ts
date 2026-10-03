import { defineConfig } from "@playwright/test";
import { chromeLaunchOptions } from "./chrome-launch";

export default defineConfig({
  testDir: ".",
  testMatch: "pane-edges.pw.ts",
  outputDir: "../../tmp/edges-playwright-results",
  preserveOutput: "always",
  reporter: "line",
  workers: 1,
  use: {
    headless: true,
    launchOptions: chromeLaunchOptions,
    trace: "off",
  },
});
