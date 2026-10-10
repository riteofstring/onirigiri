import Babel from "@babel/standalone";
import ReactCompiler from "babel-plugin-react-compiler";
import { fileURLToPath } from "node:url";
import { normalizePath } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "compile-pane-content",
      enforce: "pre",
      transform(source, id) {
        const filename = normalizePath(id.split("?")[0]);
        if (!filename.endsWith("/src/panes/onirigiri-pane-content.tsx")) return;
        const result = Babel.transform(source, {
          filename,
          parserOpts: { plugins: ["typescript", "jsx"] },
          plugins: [[ReactCompiler, { target: "19" }]],
          sourceMaps: true,
        });
        if (!result.code.includes("react/compiler-runtime"))
          throw new Error("Pane content was not compiled by React Compiler");
        return { code: result.code, map: result.map };
      },
    },
  ],
  test: {
    root: fileURLToPath(new URL("../../", import.meta.url)),
    environment: "jsdom",
    include: ["tests/compiler/**/*.test.tsx"],
    name: "compiler",
  },
});
