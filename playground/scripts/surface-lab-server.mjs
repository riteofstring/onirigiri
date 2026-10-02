import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { preview } from "vite";

const fixtureRoot = fileURLToPath(
  new URL("../../../browser-surface-lab", import.meta.url),
);
const temporaryRoot = fileURLToPath(new URL("../../tmp/", import.meta.url));
const worker = fileURLToPath(import.meta.url);

async function buildFixtures(root, outDir) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, "--build", root, outDir], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    });
    let output = "";
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-16_384);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Surface lab build failed (${code}): ${output}`)),
    );
  });
}

async function fixturePreview(root) {
  root = await realpath(root);
  await mkdir(temporaryRoot, { recursive: true });
  const outDir = await mkdtemp(join(temporaryRoot, "surface-lab-preview-"));
  try {
    await buildFixtures(root, outDir);
    const server = await preview({
      configFile: false,
      root,
      base: "/surface-lab/",
      appType: "mpa",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0, strictPort: true },
      logLevel: "silent",
    });
    return {
      middlewares: server.middlewares,
      async close() {
        await server.close();
        await rm(outDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(outDir, { recursive: true, force: true });
    throw error;
  }
}

export function surfaceLabServer(root = fixtureRoot) {
  function configure(server) {
    let pending;
    server.httpServer?.once("close", () => {
      void pending?.then((lab) => lab.close()).catch(() => {});
    });
    server.middlewares.use(async (request, response, next) => {
      const path = request.url?.split("?")[0];
      const video = path === "/assets/tier1-video.webm";
      if (!video && !path?.startsWith("/surface-lab/")) return next();
      if (!existsSync(root)) {
        response.statusCode = 503;
        response.end(
          "Place browser-surface-lab beside the onirigiri checkout to use lab examples.",
        );
        return;
      }
      try {
        pending ??= fixturePreview(root);
        const lab = await pending;
        const original = request.url;
        if (video) request.url = `/surface-lab${request.url}`;
        lab.middlewares(request, response, (error) => {
          request.url = original;
          next(error);
        });
      } catch (error) {
        next(error);
      }
    });
  }
  return {
    name: "onirigiri-example-surface-lab",
    configureServer: configure,
    configurePreviewServer: configure,
  };
}

if (process.argv[1] === worker && process.argv[2] === "--build") {
  const { build } = await import("vite");
  await build({
    configFile: false,
    root: process.argv[3],
    base: "/surface-lab/",
    logLevel: "error",
    build: {
      outDir: process.argv[4],
      emptyOutDir: true,
      rollupOptions: { input: join(process.argv[3], "fixture.html") },
    },
  });
}
