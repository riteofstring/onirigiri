import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

import { librarySource } from "../library-source";
import { surfaceLabServer } from "../scripts/surface-lab-server.mjs";

export default defineConfig({
  plugins: [surfaceLabServer()],
  root: fileURLToPath(new URL("./", import.meta.url)),
  resolve: librarySource.resolve,
  server: {
    ...librarySource.server,
    open: true,
    port: 5173,
    strictPort: true,
  },
});
