import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function assertRunSucceeded(command, result, capture, allowFailure) {
  if (result.error) {
    throw result.error;
  }
  if (result.status === 0 || allowFailure) {
    return;
  }

  const detail = capture ? `\n${result.stderr || result.stdout}` : "";
  throw new Error(`${command} exited with status ${result.status}.${detail}`);
}

export function run(command, args, options = {}) {
  const capture = options.capture ?? false;
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: capture ? "utf8" : undefined,
    env: { ...process.env, ...options.env },
    maxBuffer: options.maxBuffer ?? 50 * 1024 * 1024,
    stdio: capture ? "pipe" : "inherit",
  });

  assertRunSucceeded(command, result, capture, options.allowFailure ?? false);
  return result;
}

export function runPnpm(args, options = {}) {
  return run("pnpm", args, options);
}
