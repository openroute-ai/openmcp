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

// `drizzle-kit generate` only reads the schema, so it must not require a
// database URL. The commands that do connect (`push`, `migrate`, `studio`,
// `pull`, `introspect`) reject the placeholder below on their own, and the
// package scripts stay pointed at this file.
const url = process.env.CONSOLE_DATABASE_URL ?? ""

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
