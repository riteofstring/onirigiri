import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const playgroundRoot = fileURLToPath(
  new URL("../../playground/", import.meta.url),
);

export function requirePlaygroundCheckout(): string {
  if (!existsSync(`${playgroundRoot}node_modules`)) {
    throw new Error(
      `This test drives the demo playground and needs its dependencies installed at ${playgroundRoot}. ` +
        "Run pnpm --dir playground install --frozen-lockfile --ignore-scripts.",
    );
  }
  return playgroundRoot;
}
