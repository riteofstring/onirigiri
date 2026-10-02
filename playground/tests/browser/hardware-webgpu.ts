import { existsSync } from "node:fs";

import { chromium } from "@playwright/test";

import { chromeLaunchOptions, linuxChrome } from "./chrome-launch.ts";

const probeUrl = "http://127.0.0.1/onirigiri-hardware-webgpu-probe";

export async function requireHardwareWebGpu(): Promise<void> {
  if (
    chromeLaunchOptions.executablePath &&
    !existsSync(linuxChrome.executable)
  ) {
    throw new Error(
      `Chrome ${linuxChrome.version} headless shell is not installed; run node scripts/install-linux-chrome.mjs.`,
    );
  }
  const browser = await chromium.launch({
    ...chromeLaunchOptions,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.route(probeUrl, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    await page.goto(probeUrl);
    const adapter = await page.evaluate(async () => {
      const found = await navigator.gpu?.requestAdapter();
      return found
        ? {
            architecture: found.info.architecture,
            fallback: found.info.isFallbackAdapter,
            vendor: found.info.vendor,
          }
        : null;
    });
    if (!adapter || adapter.fallback) {
      throw new Error(
        `Browser checks require a hardware WebGPU adapter; ${browser.version()} reported ${
          adapter
            ? `software adapter ${adapter.vendor}/${adapter.architecture}`
            : "no adapter"
        }. On Linux, check that the NVIDIA Vulkan driver and libEGL.so.1 are installed.`,
      );
    }
  } finally {
    await browser.close();
  }
}
