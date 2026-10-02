import { defineConfig } from "vitest/config";

import { librarySource } from "./library-source";

export default defineConfig({
  resolve: librarySource.resolve,
  test: {
    environment: "jsdom",
    name: "playground",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
