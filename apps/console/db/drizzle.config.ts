import { existsSync } from "node:fs"
import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

// The app's own env file takes precedence, then the monorepo root. The
// previous config only read `../../.env`, which meant `db:generate` failed
// for anyone who had filled in `apps/console/.env` (as `.env.example`
// instructs) but not the root file.
for (const path of [".env", "../../.env"]) {
  if (existsSync(path)) config({ path, override: false })
}

if (!process.env.CONSOLE_DATABASE_URL) {
  throw new Error(
    "CONSOLE_DATABASE_URL is required to run Drizzle commands. " +
      "Copy apps/console/.env.example to apps/console/.env."
  )
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.CONSOLE_DATABASE_URL,
  },
  strict: true,
  verbose: true,
})
