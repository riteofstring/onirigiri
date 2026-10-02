import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { chromeLaunchOptions } from "../tests/browser/chrome-launch.ts";
import { requireHardwareWebGpu } from "../tests/browser/hardware-webgpu.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export async function launchRetainedPicturePreview(options = {}) {
  await requireHardwareWebGpu();
  options = {
    port: 5197,
    count: 50,
    viewport: { width: 1280, height: 900 },
    dpr: 2,
    headless: true,
    ...options,
  };
  const server = await createServer({
    configFile: false,
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "zustand/vanilla",
      ],
    },
    root: repositoryRoot,
    resolve: {
      alias: [
        {
          find: "@riteofstring/onirigiri/styles.css",
          replacement: join(repositoryRoot, "src/styles.css"),
        },
        {
          find: "@riteofstring/onirigiri",
          replacement: join(repositoryRoot, "src/index.ts"),
        },
      ],
    },
    server: {
      watch: {
        ignored: ["**/tmp/**", "**/.code-polishy-reports/**", "**/dist/**"],
      },
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
    const address = server.httpServer.address();
    const url = previewUrl(address.port, options);
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
  const url = new URL(
    `http://127.0.0.1:${port}/tests/browser/retained-capture.html`,
  );
  url.searchParams.set("count", String(options.count));
  if (options.contentBudget)
    url.searchParams.set("contentBudget", options.contentBudget);
  return url;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const preview = await launchRetainedPicturePreview({
    headless: false,
    viewport: null,
  });
  process.stdout.write(`Onirigiri retained-capture preview: ${preview.url}\n`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, preview.close);
}
