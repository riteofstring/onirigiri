import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, statfs } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  arch,
  cpus,
  freemem,
  loadavg,
  platform,
  release,
  totalmem,
} from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    profile: { type: "boolean", default: false },
  },
});
if (!values.output)
  throw new Error(
    "Provide a new --output directory; --profile is for separate diagnostic runs",
  );
const requiredNode = (await readFile(".node-version", "utf8")).trim();
if (process.version !== `v${requiredNode}`)
  throw new Error(`Use Node ${requiredNode}; found ${process.version}`);
const output = resolve(values.output);
await mkdir(output);
const entry = "tests/performance/workspace-cpu-workloads.ts";
await writeFile(join(output, "workloads.ts"), await readFile(entry));
const disk = await statfs(process.cwd());
const result = {
  kind: "CPU diagnostic; no graphics throughput acceptance",
  profile: values.profile,
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  changes: execFileSync("git", ["diff", "HEAD", "--", "src"], {
    encoding: "utf8",
  }),
  node: process.version,
  machine: {
    arch: arch(),
    platform: platform(),
    release: release(),
    cpus: cpus(),
    memory: totalmem(),
    freeMemory: freemem(),
    availableDisk: disk.bavail * disk.bsize,
    load: loadavg(),
  },
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  workloads: [],
  errors: [],
};
await build({
  configFile: false,
  logLevel: "error",
  build: {
    outDir: join(output, "assets"),
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(entry),
      formats: ["iife"],
      name: "cpu",
      fileName: () => "cpu-workloads.js",
    },
  },
});
const server = createServer(async (request, response) => {
  if (request.url === "/") {
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><title>Workspace CPU diagnostic</title>");
  } else if (request.url === "/cpu-workloads.js") {
    response.setHeader("content-type", "text/javascript");
    response.end(await readFile(join(output, "assets/cpu-workloads.js")));
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
let browser;
try {
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-blink-features=CanvasDrawElement"],
  });
  result.browser = browser.version();
  const session = await browser.newBrowserCDPSession();
  result.gpu = (await session.send("SystemInfo.getInfo")).gpu;
  await session.detach();
  const page = await browser.newPage({
    viewport: result.viewport,
    deviceScaleFactor: result.deviceScaleFactor,
  });
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  result.blankFrameIntervals = await page.evaluate(
    () =>
      new Promise((done) => {
        const intervals = [];
        let previous;
        const tick = (time) => {
          if (previous !== undefined) intervals.push(time - previous);
          previous = time;
          if (intervals.length === 180) done(intervals);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.addScriptTag({
    url: `http://127.0.0.1:${server.address().port}/cpu-workloads.js`,
  });
  await writeFile(
    join(output, "processes-before.txt"),
    execFileSync("ps", ["-axo", "pid,ppid,etime,pcpu,pmem,comm"]),
  );
  const cdp = await page.context().newCDPSession(page);
  if (values.profile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
  }
  try {
    const names = await page.evaluate(() => window.cpu.scenarios);
    for (const name of names) {
      await page.evaluate((scenario) => window.cpu.run(scenario, 20), name);
      for (let run = 0; run < 5; run++)
        result.workloads.push(
          await page.evaluate(
            (scenario) => window.cpu.run(scenario, 100),
            name,
          ),
        );
      console.log(name);
    }
  } finally {
    if (values.profile)
      await writeFile(
        join(output, "cpu-profile.json"),
        JSON.stringify((await cdp.send("Profiler.stop")).profile),
      );
    await cdp.detach();
  }
  if (result.errors.length)
    throw new Error("Browser errors occurred; inspect measurements.json");
} catch (error) {
  result.failure = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(
    join(output, "processes-after.txt"),
    execFileSync("ps", ["-axo", "pid,ppid,etime,pcpu,pmem,comm"]),
  );
  await writeFile(
    join(output, "measurements.json"),
    JSON.stringify(result, null, 2),
  );
  await browser?.close();
  await new Promise((closed) => server.close(closed));
}
