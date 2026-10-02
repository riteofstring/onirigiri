import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { fileURLToPath, pathToFileURL } from "node:url";

import { librarySource } from "../library-source.ts";
import { chromeLaunchOptions } from "../tests/browser/chrome-launch.ts";
import { requireHardwareWebGpu } from "../tests/browser/hardware-webgpu.ts";
import { surfaceLabServer } from "./surface-lab-server.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const examples = ["one-dimensional", "two-dimensional"];

export async function launchPlaygroundPreview(options) {
  if (!examples.includes(options.example))
    throw new Error(`Choose one of: ${examples.join(", ")}`);
  await requireHardwareWebGpu();
  options = {
    port: 5197,
    count: 10,
    viewport: { width: 1280, height: 900 },
    dpr: 2,
    headless: true,
    ...options,
  };
  const server = await createServer({
    configFile: false,
    plugins: [surfaceLabServer()],
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    root: repositoryRoot,
    resolve: librarySource.resolve,
    server: {
      ...librarySource.server,
      watch: { ignored: ["**/tmp/**", "**/dist/**"] },
      open: false,
      port: options.port,
      strictPort: true,
      host: "127.0.0.1",
    },
  });
  let browser;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  };
  try {
    await server.listen();
    browser = await chromium.launch({
      ...chromeLaunchOptions,
      headless: options.headless,
    });
    const context = await browser.newContext(
      options.viewport === null
        ? { viewport: null }
        : {
            viewport: options.viewport,
            deviceScaleFactor: options.dpr,
          },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const url = previewUrl(server.httpServer.address().port, options);
    page.once("close", close);
    browser.once("disconnected", close);
    await page.goto(url.href);
    return { url: url.href, page, context, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function previewUrl(port, options) {
  const url = new URL(`http://127.0.0.1:${port}/${options.example}/`);
  url.searchParams.set("count", String(options.count));
  for (const key of ["fixtureOrigin", "fixturePath", "protocol"]) {
    if (options[key]) url.searchParams.set(key, options[key]);
  }
  return url;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const preview = await launchPlaygroundPreview({
    headless: false,
    viewport: null,
    example: process.argv[2] ?? "two-dimensional",
  });
  process.stdout.write(`Onirigiri playground: ${preview.url}\n`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, preview.close);
}
