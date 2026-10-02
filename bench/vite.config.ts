import { defineConfig } from "vite";

const librarySource = new URL("../src/index.ts", import.meta.url).pathname;
const libraryStyles = new URL("../src/styles.css", import.meta.url).pathname;

export default defineConfig({
  root: new URL("./", import.meta.url).pathname,
  resolve: {
    alias: [
      {
        find: "@riteofstring/onirigiri/styles.css",
        replacement: libraryStyles,
      },
      { find: "@riteofstring/onirigiri", replacement: librarySource },
      { find: "react-dom/client", replacement: "react-dom/profiling" },
    ],
  },
  server: {
    open: false,
    port: 4175,
    strictPort: true,
  },
});
