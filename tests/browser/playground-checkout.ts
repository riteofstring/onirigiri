import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const playgroundRoot = fileURLToPath(
  new URL("../../../onirigiri-playground/", import.meta.url),
);

export function requirePlaygroundCheckout(): string {
  if (!existsSync(`${playgroundRoot}node_modules`)) {
    throw new Error(
      `This test drives the demo playground and needs an installed checkout at ${playgroundRoot}. ` +
        "Clone https://github.com/riteofstring/onirigiri-playground beside onirigiri and run " +
        "pnpm install --frozen-lockfile --ignore-scripts in it.",
    );
  }
  return playgroundRoot;
}
