import { defineConfig } from "vitest/config";

import { librarySource } from "./library-source";

export default defineConfig({
  resolve: librarySource.resolve,
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
