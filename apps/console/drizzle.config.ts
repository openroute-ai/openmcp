import { defineConfig } from "drizzle-kit"
import { loadConsoleEnv } from "./src/db/load-env"
import { toDiscreteCredentials } from "./src/db/ssl"

// One loader for every script that needs the database URL: `db:generate`,
// `db:migrate` and the seed/role scripts have to agree on which file wins,
// because a migration applied to one database and a seed run against another
// is the kind of mismatch that is only discovered much later.
loadConsoleEnv()

// `drizzle-kit generate` only reads the schema, so it must not require a
// database URL. The commands that do connect (`push`, `migrate`, `studio`,
// `pull`, `introspect`) reject the placeholder below on their own, and the
// package scripts stay pointed at this file.
const url = process.env.CONSOLE_DATABASE_URL ?? ""

export default defineConfig({
  // `./src/db/drizzle-schema`, not `./src/db/schema`: the latter re-exports
  // `@workspace/db/schema` wholesale, and drizzle-kit walks every export of
  // the entry module, so it would generate migrations for the shared blog,
  // workflow, persona and marketplace tables as well. The entry file spells
  // out the tables console owns, one by one.
  schema: "./src/db/drizzle-schema.ts",
  out: "./src/db/drizzle",
  dialect: "postgresql",
  // The discrete form because drizzle-kit hands a `url` nothing but to
  // `pg.Pool` and drops the `ssl` option next to it, which would leave a
  // managed provider to accept a plaintext connection.
  dbCredentials: url ? toDiscreteCredentials(url) : { url },
  strict: true,
  verbose: true,
})
