import { spawn } from "node:child_process";

import { requirePlaygroundCheckout } from "../tests/browser/playground-checkout.ts";

let root;
try {
  root = requirePlaygroundCheckout();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
const server = spawn("pnpm", ["--dir", root, ...process.argv.slice(2)], {
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.kill(signal));
server.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
