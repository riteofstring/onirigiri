import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { linuxChrome } from "../tests/browser/chrome-launch.ts";
import { run } from "./lib/process.mjs";

if (existsSync(linuxChrome.executable)) {
  console.log(`Chrome ${linuxChrome.version} headless shell is installed.`);
  process.exit(0);
}

const response = await fetch(linuxChrome.url);
if (!response.ok) {
  throw new Error(`Downloading ${linuxChrome.url} failed: ${response.status}`);
}
const archive = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(archive).digest("hex");
if (digest !== linuxChrome.sha256) {
  throw new Error(
    `Chrome ${linuxChrome.version} archive digest ${digest} does not match ${linuxChrome.sha256}.`,
  );
}

const cacheRoot = path.dirname(linuxChrome.directory);
mkdirSync(cacheRoot, { recursive: true });
const staging = mkdtempSync(path.join(cacheRoot, ".install-"));
try {
  const archivePath = path.join(staging, "chrome-headless-shell.zip");
  writeFileSync(archivePath, archive);
  const extracted = path.join(staging, "extracted");
  run("unzip", ["-q", archivePath, "-d", extracted]);
  try {
    renameSync(extracted, linuxChrome.directory);
  } catch (error) {
    if (!existsSync(linuxChrome.executable)) throw error;
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
console.log(`Installed Chrome ${linuxChrome.version} headless shell.`);
