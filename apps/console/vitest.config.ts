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
    // `next-intl/middleware` imports `next/server` without the extension, which
    // Node's ESM resolver rejects because `next` ships no `exports` map. Next's
    // own bundler is fine with it, so inlining the package lets Vite resolve it
    // the same way — which is what lets a test import `src/proxy.ts` and assert
    // on its matcher rather than on a copy of it.
    server: { deps: { inline: ["next-intl"] } },
    // The integration suites share one PostgreSQL instance and each clears
    // the tables it touches in `beforeAll`. Running files concurrently
    // therefore has one suite truncating rows another suite is asserting
    // on, which shows up as unrelated intermittent failures. Sequential
    // execution is also closer to how a task run actually behaves.
    fileParallelism: false,
  },
})
