import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  cacheDir: fileURLToPath(
    new URL("../../tmp/native-cadence-vite-cache", import.meta.url),
  ),
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(
      new URL("../../tmp/native-cadence-build", import.meta.url),
    ),
    rolldownOptions: {
      input: [
        fileURLToPath(new URL("./native-content-guard.html", import.meta.url)),
        fileURLToPath(new URL("./native-content-frame.html", import.meta.url)),
      ],
    },
  },
  preview: { port: 4176, strictPort: true },
});
