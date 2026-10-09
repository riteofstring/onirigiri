import { homedir, platform } from "node:os";
import { join } from "node:path";

import type { LaunchOptions } from "@playwright/test";

const onLinux = platform() === "linux";
const linuxChromeVersion = "154.0.8037.57";
const linuxChromeDirectory = join(
  homedir(),
  ".cache",
  "onirigiri",
  "chrome-for-testing",
  linuxChromeVersion,
);

export const linuxChrome = {
  version: linuxChromeVersion,
  url: `https://storage.googleapis.com/chrome-for-testing-public/${linuxChromeVersion}/linux64/chrome-headless-shell-linux64.zip`,
  sha256: "5a6979d0ab7cf952ea575d35164e7bdce4872b2ced8f8a215c8f8e8eda00ee09",
  directory: linuxChromeDirectory,
  executable: join(
    linuxChromeDirectory,
    "chrome-headless-shell-linux64",
    "chrome-headless-shell",
  ),
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
