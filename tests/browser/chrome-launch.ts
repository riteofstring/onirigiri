import { homedir, platform } from "node:os";
import { join } from "node:path";

import type { LaunchOptions } from "@playwright/test";

const onLinux = platform() === "linux";
const linuxChromeVersion = "156.0.8078.80";
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
  sha256: "547dcd374e02961bf998f6046a267644f8502225c36bb78ca307dab32a0b3eb4",
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
