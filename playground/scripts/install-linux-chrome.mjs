import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

const staging = mkdtempSync(path.join(tmpdir(), "onirigiri-chrome-"));
try {
  const archivePath = path.join(staging, "chrome-headless-shell.zip");
  writeFileSync(archivePath, archive);
  const extracted = path.join(staging, "extracted");
  run("unzip", ["-q", archivePath, "-d", extracted]);
  mkdirSync(path.dirname(linuxChrome.directory), { recursive: true });
  run("mv", [extracted, linuxChrome.directory]);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
console.log(`Installed Chrome ${linuxChrome.version} headless shell.`);
