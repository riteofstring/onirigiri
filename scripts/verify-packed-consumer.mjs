import { chromium, expect } from "@playwright/test";
import { preview } from "vite";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { repositoryRoot, run, runPnpm } from "./lib/process.mjs";
import { chromeLaunchOptions } from "../tests/browser/chrome-launch.ts";
import { requireHardwareWebGpu } from "../tests/browser/hardware-webgpu.ts";

const fixtureRoot = path.join(repositoryRoot, "fixtures/packed-consumer");
const fixtureManifestPath = path.join(fixtureRoot, "package.template.json");
const tarballPlaceholder = "file:__ONIRIGIRI_TARBALL__";
const allowedImportSpecifiers = new Set([
  "react",
  "react-dom/client",
  "@riteofstring/onirigiri",
  "@riteofstring/onirigiri/styles.css",
]);

function assertConsumerImportSurface() {
  const violations = readdirSync(path.join(fixtureRoot, "src")).flatMap(
    (fileName) => {
      const contents = readFileSync(
        path.join(fixtureRoot, "src", fileName),
        "utf8",
      );
      const specifiers = [
        ...contents.matchAll(/(?:from|^\s*import)\s+["']([^"']+)["']/gmu),
      ].map((match) => match[1]);
      return specifiers
        .filter((specifier) => !allowedImportSpecifiers.has(specifier))
        .filter((specifier) => !specifier.startsWith("."))
        .map((specifier) => `src/${fileName}: forbidden import ${specifier}`);
    },
  );
  if (violations.length > 0) {
    throw new Error(
      `Packed-consumer import violations:\n${violations.join("\n")}`,
    );
  }
}

function assertFixtureManifest() {
  const manifest = JSON.parse(readFileSync(fixtureManifestPath, "utf8"));
  if (
    manifest.dependencies?.["@riteofstring/onirigiri"] !== tarballPlaceholder
  ) {
    throw new Error(
      `Fixture must depend on Onirigiri through ${tarballPlaceholder}`,
    );
  }
  const linked = Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }).filter(([, specifier]) => /^(?:workspace|link):/u.test(specifier));
  if (linked.length > 0) {
    throw new Error(
      `Fixture must be unrelated to the workspace: ${linked.map(([name]) => name)}`,
    );
  }
}

function buildAndPack(artifactDirectory) {
  runPnpm(["run", "build"]);
  runPnpm(["pack", "--pack-destination", artifactDirectory]);
  const tarballs = readdirSync(artifactDirectory).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (tarballs.length !== 1) {
    throw new Error(`Expected one packed tarball, found ${tarballs.length}`);
  }
  return path.join(artifactDirectory, tarballs[0]);
}

function assertTarballContents(tarballPath) {
  const entries = run("tar", ["-tzf", tarballPath], { capture: true })
    .stdout.split("\n")
    .filter(Boolean);
  const entrySet = new Set(entries);
  const required = [
    "package/LICENSE",
    "package/README.md",
    "package/dist/index.d.ts",
    "package/dist/onirigiri.css",
    "package/dist/onirigiri.js",
    "package/dist/onirigiri.js.map",
    "package/package.json",
  ];
  const problems = [
    ...required
      .filter((entry) => !entrySet.has(entry))
      .map((entry) => `missing ${entry}`),
    ...entries
      .filter((entry) => entry.startsWith("package/src/"))
      .map((entry) => `packs ${entry}`),
    ...entries
      .filter((entry) =>
        /(?:tsconfig|vite\.config|vitest|node_modules)/u.test(entry),
      )
      .map((entry) => `packs build configuration ${entry}`),
  ];
  if (problems.length > 0) {
    throw new Error(
      `Packed tarball is not the compiled surface:\n${problems.join("\n")}`,
    );
  }
}

function materializeConsumer(consumerRoot, tarballPath) {
  cpSync(fixtureRoot, consumerRoot, { recursive: true });
  const manifestPath = path.join(consumerRoot, "package.json");
  const manifestTemplatePath = path.join(consumerRoot, "package.template.json");
  writeFileSync(
    manifestPath,
    readFileSync(manifestTemplatePath, "utf8").replace(
      tarballPlaceholder,
      `file:${tarballPath}`,
    ),
  );
  rmSync(manifestTemplatePath);
}

function assertBuiltConsumer(consumerRoot) {
  if (!existsSync(path.join(consumerRoot, "dist/index.html"))) {
    throw new Error("Built consumer is missing dist/index.html");
  }
  const assetsRoot = path.join(consumerRoot, "dist/assets");
  const assets = readdirSync(assetsRoot);
  const scripts = assets
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(path.join(assetsRoot, name), "utf8"));
  const styles = assets
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(path.join(assetsRoot, name), "utf8"));
  if (
    !scripts.some((contents) => contents.includes("Packed Onirigiri consumer"))
  ) {
    throw new Error(
      "Consumer bundle does not contain the packed Onirigiri fixture",
    );
  }
  if (!styles.some((contents) => contents.includes(".onirigiri-workspace"))) {
    throw new Error(
      "Consumer bundle does not contain Onirigiri's compiled stylesheet",
    );
  }
}

async function verifyConsumerInBrowser(consumerRoot) {
  await requireHardwareWebGpu();
  const server = await preview({
    root: consumerRoot,
    configFile: false,
    preview: { port: 0, host: "127.0.0.1" },
  });
  const browser = await chromium.launch({
    ...chromeLaunchOptions,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const address = server.httpServer.address();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const pane = page.locator('[data-onirigiri-pane-id="packed-document"]');
    await expect(pane).toHaveAttribute("data-onirigiri-picture-ready", "true");
    const note = page.getByRole("textbox", { name: "Packed document note" });
    await note.fill("Preserved through picture presentation");
    await page.getByRole("button", { name: "Show saved pictures" }).click();
    const picture = pane.locator('[data-onirigiri-slot="pane-picture"]');
    await expect(picture).toBeVisible();
    await expect(note).toBeHidden();
    await expect.poll(() => savedPicturePixels(page, picture)).toBe(true);
    await expect(picture).toHaveCSS("border-radius", "8px");
    await page.emulateMedia({ forcedColors: "active" });
    await page.getByRole("button", { name: "Show live content" }).click();
    await expect(note).toHaveValue("Preserved through picture presentation");
    await expect(picture).toBeHidden();
    await expect(
      pane.getByRole("button", { name: "Maximize pane", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: path.join(consumerRoot, "consumer.png") });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
}

async function savedPicturePixels(page, picture) {
  const screenshot = await picture.screenshot();
  return page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = [
      [239, 230, 210],
      [80, 63, 101],
    ];
    return colors.every((color) => {
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          color.every((channel, offset) => pixels[index + offset] === channel)
        ) {
          return true;
        }
      }
      return false;
    });
  }, screenshot.toString("base64"));
}

const keepConsumer = process.argv.includes("--keep");
const temporaryRoot = mkdtempSync(
  path.join(tmpdir(), "onirigiri-packed-consumer-"),
);
const artifactDirectory = path.join(temporaryRoot, "artifact");
const consumerRoot = path.join(temporaryRoot, "consumer");

try {
  assertConsumerImportSurface();
  assertFixtureManifest();
  mkdirSync(artifactDirectory);
  const tarballPath = buildAndPack(artifactDirectory);
  assertTarballContents(tarballPath);
  materializeConsumer(consumerRoot, tarballPath);
  runPnpm(["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: consumerRoot,
  });
  runPnpm(["install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: consumerRoot,
  });
  runPnpm(["run", "build"], { cwd: consumerRoot });
  assertBuiltConsumer(consumerRoot);
  await verifyConsumerInBrowser(consumerRoot);
  console.log(
    "Packed consumer built and verified picture readiness, custom styling and live content through public exports.",
  );
  if (keepConsumer) {
    console.log(`Kept for inspection: ${consumerRoot}`);
  }
} finally {
  if (!keepConsumer) {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}
