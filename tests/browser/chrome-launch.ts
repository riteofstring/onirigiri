import { platform } from "node:os";

import type { LaunchOptions } from "@playwright/test";

const onLinux = platform() === "linux";

export const linuxChrome = {
  version: "154.0.8037.57",
  url: "https://storage.googleapis.com/chrome-for-testing-public/154.0.8037.57/linux64/chrome-headless-shell-linux64.zip",
  sha256: "5a6979d0ab7cf952ea575d35164e7bdce4872b2ced8f8a215c8f8e8eda00ee09",
  directory: new URL(
    "../../node_modules/.cache/chrome-for-testing/154.0.8037.57/",
    import.meta.url,
  ).pathname,
  executable: new URL(
    "../../node_modules/.cache/chrome-for-testing/154.0.8037.57/chrome-headless-shell-linux64/chrome-headless-shell",
    import.meta.url,
  ).pathname,
};

const linuxVulkanWebGpuArgs = [
  "--enable-unsafe-webgpu",
  "--use-angle=vulkan",
  "--enable-features=Vulkan",
  "--disable-vulkan-surface",
  "--ignore-gpu-blocklist",
];

export const chromeArgs = [
  "--enable-blink-features=CanvasDrawElement",
  ...(onLinux ? linuxVulkanWebGpuArgs : []),
];

export const chromeLaunchOptions: LaunchOptions & { args: string[] } = onLinux
  ? { executablePath: linuxChrome.executable, args: chromeArgs }
  : { channel: "chrome", args: chromeArgs };
