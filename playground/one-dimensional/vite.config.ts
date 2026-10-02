import { defineConfig } from "vite";

import { librarySource } from "../library-source";
import { surfaceLabServer } from "../scripts/surface-lab-server.mjs";

export default defineConfig({
  plugins: [surfaceLabServer()],
  root: new URL("./", import.meta.url).pathname,
  resolve: librarySource.resolve,
  server: {
    ...librarySource.server,
    open: true,
    port: 5173,
    strictPort: true,
  },
});
