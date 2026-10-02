import { defineConfig } from "vitest/config";

const testLibraryAlias = {
  "@riteofstring/onirigiri": new URL("./src/index.ts", import.meta.url)
    .pathname,
};

const jsdomTestFiles = [
  "tests/OnirigiriWorkspace-focus-surface.test.tsx",
  "tests/OnirigiriWorkspace-history.test.tsx",
  "tests/OnirigiriWorkspace-rearrangement.test.tsx",
  "tests/OnirigiriWorkspace-shortcuts.test.tsx",
  "tests/OnirigiriWorkspace.test.tsx",
  "tests/overview-motion-registration.test.ts",
  "tests/pane-host-registration.test.tsx",
  "tests/pane-cold-content-admission.test.tsx",
  "tests/pane-presentation-engine.test.ts",
  "tests/performance/performance-frame-work.test.ts",
  "tests/workspace-frame-scheduler.test.ts",
  "tests/workspace-grid-cursor-presentation.test.ts",
  "tests/workspace-chrome-components.test.tsx",
  "tests/workspace-minimap.test.tsx",
  "tests/workspace-motion-options.test.tsx",
  "tests/workspace-shortcut-runtime.test.ts",
  "tests/workspace-world-presentation.test.ts",
];

export default defineConfig({
  build: {
    lib: {
      cssFileName: "onirigiri",
      entry: "src/onirigiri.ts",
      fileName: "onirigiri",
      formats: ["es"],
    },
    sourcemap: true,
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "zustand/vanilla",
      ],
    },
  },
  test: {
    projects: [
      {
        resolve: { alias: testLibraryAlias },
        test: {
          environment: "jsdom",
          include: jsdomTestFiles,
          name: "jsdom",
        },
      },
      {
        resolve: { alias: testLibraryAlias },
        test: {
          environment: "node",
          exclude: jsdomTestFiles,
          include: ["tests/**/*.test.{ts,tsx}"],
          name: "node",
        },
      },
      "playground/vitest.config.ts",
    ],
  },
});
