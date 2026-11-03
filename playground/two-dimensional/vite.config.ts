import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

import { librarySource } from "../library-source";
import { surfaceLabServer } from "../scripts/surface-lab-server.mjs";
import { disableDevEditor } from "../../scripts/disable-dev-editor.mjs";

export default defineConfig({
  base: "./",
  plugins: [disableDevEditor(), surfaceLabServer()],
  root: fileURLToPath(new URL("./", import.meta.url)),
  resolve: librarySource.resolve,
  server: {
    ...librarySource.server,
    open: true,
    port: 5174,
    strictPort: true,
  },
});
