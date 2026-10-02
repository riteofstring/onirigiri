import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

await test(
  "CPU diagnostics retain measured workloads and refuse to replace evidence",
  { timeout: 180_000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "onirigiri-cpu-contract-"));
    const output = join(temporary, "run");
    const command = resolve("scripts/measure-workspace-cpu.mjs");
    const requiredNode = (await readFile(".node-version", "utf8")).trim();
    const invocation = await measurementInvocation(
      command,
      output,
      requiredNode,
    );
    try {
      await execute(invocation.executable, invocation.args, {
        timeout: 150_000,
      });
      const result = JSON.parse(
        await readFile(join(output, "measurements.json"), "utf8"),
      );
      assert.equal(result.node, `v${requiredNode}`);
      assert.equal(result.profile, true);
      assert.equal(result.failure, undefined);
      assert.deepEqual(result.errors, []);
      assert.match(result.browser, /^\d+\./);
      assert.equal(result.blankFrameIntervals.length, 180);
      assert(
        result.blankFrameIntervals.every(
          (value) => Number.isFinite(value) && value > 0,
        ),
      );
      const groups = Map.groupBy(result.workloads, (workload) => workload.name);
      assert.equal(groups.size, 14);
      for (const [name, workloads] of groups) {
        assert.equal(workloads.length, 5, name);
        for (const workload of workloads) {
          assert.equal(workload.iterations, 100, name);
          assert.equal(workload.samples.length, 100, name);
          assert(
            workload.samples.every(
              (value) => Number.isFinite(value) && value >= 0,
            ),
            name,
          );
          assert(Number.isFinite(workload.checksum), name);
          if (name.startsWith("capability-"))
            assert.equal(workload.queries, 6000, name);
          else
            assert.equal(
              workload.paneCount,
              name.endsWith("500") ? 500 : 100,
              name,
            );
        }
      }
      for (const name of [
        "capability-graphics",
        "render-normal-100",
        "render-overview-100",
        "render-normal-500",
        "shells-500",
        "activation-500",
        "camera-center-500",
      ])
        assert(groups.has(name), name);
      const profile = JSON.parse(
        await readFile(join(output, "cpu-profile.json"), "utf8"),
      );
      assert(profile.nodes.length > 0);
      assert(profile.samples.length > 0);
      assert(profile.endTime > profile.startTime);
      assert(
        (await readFile(join(output, "assets/cpu-workloads.js"), "utf8"))
          .length > 0,
      );
      await writeFile(join(output, "keep.txt"), "retained evidence");
      await assert.rejects(
        execute(invocation.executable, invocation.args),
        (error) => error.code === 1 && error.stderr.includes("EEXIST"),
      );
      assert.equal(
        await readFile(join(output, "keep.txt"), "utf8"),
        "retained evidence",
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

async function measurementInvocation(command, output, requiredNode) {
  const args = [command, "--output", output, "--profile"];
  if (process.version === `v${requiredNode}`) {
    return { args, executable: process.execPath };
  }
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const candidates = new Set(
    (process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, executableName)),
  );
  for (const executable of candidates) {
    try {
      const probe = await execute(executable, ["-p", "process.version"], {
        timeout: 10_000,
      });
      if (probe.stdout.trim() === `v${requiredNode}`) {
        return { args, executable };
      }
    } catch {
      continue;
    }
  }
  throw new Error(`Use Node ${requiredNode}; found ${process.version}`);
}
