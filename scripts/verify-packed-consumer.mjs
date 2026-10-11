import { chromium, expect } from "@playwright/test";
import { createServer, preview } from "vite";
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

async function verifyConsumerInBrowser(consumerRoot, mode) {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = mode;
  let server;
  let browser;
  try {
    const config = { root: consumerRoot, configFile: false, mode };
    const addressOptions = { port: 0, host: "127.0.0.1" };
    if (mode === "development") {
      server = await createServer({
        ...config,
        optimizeDeps: { include: ["@riteofstring/onirigiri"] },
        server: addressOptions,
      });
      await server.listen();
    } else {
      server = await preview({ ...config, preview: addressOptions });
    }
    browser = await chromium.launch({
      ...chromeLaunchOptions,
      headless: true,
    });
    const page = await browser.newPage();
    const address = server.httpServer.address();
    const origin = `http://127.0.0.1:${address.port}`;
    await page.goto(origin);
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
    await page.screenshot({
      path: path.join(consumerRoot, `consumer-${mode}.png`),
    });
    await page.close();
    await verifyBackgroundCapture(browser, origin, mode);
  } finally {
    try {
      try {
        await browser?.close();
      } finally {
        if (server?.close) await server.close();
        else if (server) {
          await new Promise((resolve) => server.httpServer.close(resolve));
        }
      }
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  }
}

function observeCaptureWorker() {
  const evidence = { sent: [], received: [], errors: [], pending: 0 };
  window.__captureWorker = evidence;
  const workers = new WeakMap();
  let nextWorker = 0;
  const postMessage = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, transfer) {
    if (!["prepare", "capture"].includes(message?.type)) {
      return Reflect.apply(postMessage, this, arguments);
    }
    if (!workers.has(this)) {
      const worker = ++nextWorker;
      workers.set(this, worker);
      this.addEventListener("error", (event) =>
        evidence.errors.push(event.message),
      );
      this.addEventListener("messageerror", () =>
        evidence.errors.push("messageerror"),
      );
      this.addEventListener("message", async ({ data }) => {
        const reply = { worker, type: data.type, id: data.id };
        evidence.received.push(reply);
        if (data.type === "failed") evidence.errors.push(data.message);
        if (data.type !== "captured") return;
        reply.bytes = data.image.size;
        reply.mime = data.image.type;
        evidence.pending++;
        let bitmap;
        try {
          bitmap = await createImageBitmap(data.image);
          reply.width = bitmap.width;
          reply.height = bitmap.height;
          const context = new OffscreenCanvas(1, 1).getContext("2d");
          context.drawImage(
            bitmap,
            Math.floor(bitmap.width / 2),
            Math.floor(bitmap.height * 0.8),
            1,
            1,
            0,
            0,
            1,
            1,
          );
          reply.pixel = [...context.getImageData(0, 0, 1, 1).data];
        } catch (error) {
          evidence.errors.push(String(error));
        } finally {
          bitmap?.close();
          evidence.pending--;
        }
      });
    }
    const transfers = Array.isArray(transfer)
      ? transfer
      : (transfer?.transfer ?? []);
    evidence.sent.push({
      worker: workers.get(this),
      type: message.type,
      id: message.id,
      width: message.width,
      height: message.height,
      transfers: transfers.map((value) => value.constructor.name),
      transferredImage: transfers[0] === message.image,
    });
    return Reflect.apply(postMessage, this, arguments);
  };
}

async function verifyBackgroundCapture(browser, origin, mode) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const scripts = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.push(response.url());
  });
  await page.addInitScript(observeCaptureWorker);
  await page.goto(`${origin}/?capture`);
  await expect(page.locator("main")).toHaveAttribute(
    "data-production",
    String(mode === "production"),
  );
  if (mode === "development") {
    expect(
      scripts.some((url) =>
        /\/\.vite\/deps\/.*riteofstring_onirigiri/u.test(url),
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Capture all panes" }).click();
  const status = page.getByRole("status", { name: "Captured panes" });
  await expect(status).toHaveText("6", { timeout: 30_000 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const evidence = window.__captureWorker;
        return (
          evidence.pending === 0 &&
          evidence.sent.filter((message) => message.type === "capture")
            .length ===
            evidence.received.filter((message) => message.type === "captured")
              .length
        );
      }),
    )
    .toBe(true);
  const evidence = await page.evaluate(() => window.__captureWorker);
  expect(errors).toEqual([]);
  expect(evidence.errors).toEqual([]);
  expect(evidence.received.some((reply) => reply.type === "prepared")).toBe(
    true,
  );
  const requests = evidence.sent.filter(
    (message) => message.type === "capture",
  );
  const replies = evidence.received.filter(
    (message) => message.type === "captured",
  );
  expect(requests.length).toBeGreaterThanOrEqual(3);
  expect(replies).toHaveLength(requests.length);
  const acceptedIds = JSON.parse(await status.getAttribute("data-capture-ids"));
  for (const request of requests) {
    expect(request.transfers).toEqual(["ElementImage"]);
    expect(request.transferredImage).toBe(true);
    const reply = replies.find(
      (value) => value.worker === request.worker && value.id === request.id,
    );
    expect(reply).toMatchObject({
      width: request.width,
      height: request.height,
      mime: "image/png",
      pixel: [17, 83, 137, 255],
    });
    expect(reply.bytes).toBeGreaterThan(0);
    expect(acceptedIds).toContain(request.id);
  }
  console.log(
    `Packed consumer ${mode}: ${requests.length} worker captures accepted with matching PNG pixels.`,
  );
  await page.close();
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
  runPnpm(["run", "build"], {
    cwd: consumerRoot,
    env: { NODE_ENV: "production" },
  });
  assertBuiltConsumer(consumerRoot);
  await requireHardwareWebGpu();
  for (const mode of ["development", "production"]) {
    await verifyConsumerInBrowser(consumerRoot, mode);
  }
  console.log(
    "Packed consumer verified picture readiness, custom styling, live content and background worker captures through public exports in prebundled development and production.",
  );
  if (keepConsumer) {
    console.log(`Kept for inspection: ${consumerRoot}`);
  }
} finally {
  if (!keepConsumer) {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}
