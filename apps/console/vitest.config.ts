import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/test/**/*.test.ts"],
    // The integration suites share one PostgreSQL instance and each clears
    // the tables it touches in `beforeAll`. Running files concurrently
    // therefore has one suite truncating rows another suite is asserting
    // on, which shows up as unrelated intermittent failures. Sequential
    // execution is also closer to how a task run actually behaves.
    fileParallelism: false,
  },
})
