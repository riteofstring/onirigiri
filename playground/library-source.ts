import { fileURLToPath } from "node:url";

import type { UserConfig } from "vite";

const playgroundRoot = fileURLToPath(new URL("./", import.meta.url));
const libraryRoot = fileURLToPath(new URL("../", import.meta.url));

export const librarySource = {
  resolve: {
    alias: [
      {
        find: "@riteofstring/onirigiri/styles.css",
        replacement: `${libraryRoot}src/styles.css`,
      },
      {
        find: "@riteofstring/onirigiri",
        replacement: `${libraryRoot}src/index.ts`,
      },
    ],
    dedupe: ["react", "react-dom"],
  },
  server: { fs: { allow: [playgroundRoot, libraryRoot] } },
} satisfies UserConfig;
