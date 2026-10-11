import { loadConsoleEnv } from "@/db/load-env"

// Vitest runs this before any test module is evaluated, which is what makes
// `@/db/client` safe to import statically: its pool is built at module scope,
// and ES import hoisting would run a top-level `loadConsoleEnv()` in the test
// file itself *after* that body. Vite only forwards `VITE_`-prefixed vars to
// `process.env`, so without this every integration suite would see
// `CONSOLE_DATABASE_URL` unset and skip instead of fail.
loadConsoleEnv()

// ---------------------------------------------------------------------------
// DESTRUCTIVE TEST GUARD — READ THIS BEFORE CHANGING ANYTHING BELOW.
//
// The integration suites start from a clean slate by deleting whole tables
// with no `WHERE` clause (`await db.delete(projects)`, `await db.delete(repos)`,
// `await db.delete(tags)`, ... — see `admin-webui.integration.test.ts` and the
// ~24 files like it). Running them is therefore a DESTRUCTIVE operation: it
// wipes every row in the tables each suite touches and leaves its own fixtures
// behind.
//
// `CONSOLE_DATABASE_URL` is the *application's* database. In a deployment that
// is the production database — the catalogue, the repositories, the curator's
// categories, the hall of fame. Pointing the suites at it has already happened
// once and destroyed real data, so the two are kept deliberately separate:
//
//   * Integration suites run ONLY when `CONSOLE_TEST_DATABASE_URL` is set.
//     That variable is the explicit "yes, it is safe to delete everything in
//     this database" opt-in. It must name a throwaway/test database.
//
//   * When it is unset — the default — `CONSOLE_DATABASE_URL` is removed from
//     the environment, so every suite's `Boolean(process.env.CONSOLE_DATABASE_URL)`
//     is false and the suite skips instead of touching a real database.
//
// RULE (for humans and agents alike): never run a test that deletes rows
// against `CONSOLE_DATABASE_URL`. If a suite needs a database, give it
// `CONSOLE_TEST_DATABASE_URL`. Do not "fix" a skipping suite by pointing
// `CONSOLE_DATABASE_URL` at it. See the root `AGENTS.md`.
// ---------------------------------------------------------------------------

const testUrl = process.env.CONSOLE_TEST_DATABASE_URL?.trim()

if (!testUrl) {
  // No explicit test database was provided: make integration suites skip rather
  // than letting them fall through to the application database. Deleting the
  // variable is the whole point — it turns "wiped production" into "skipped".
  delete process.env.CONSOLE_DATABASE_URL
} else {
  const appUrl = process.env.CONSOLE_DATABASE_URL?.trim()
  if (appUrl && appUrl === testUrl) {
    throw new Error(
      "CONSOLE_TEST_DATABASE_URL must not equal CONSOLE_DATABASE_URL. The " +
        "integration suites delete whole tables, so testing against the " +
        "application database would destroy its data. Point " +
        "CONSOLE_TEST_DATABASE_URL at a throwaway database."
    )
  }

  // The suites and `@/db/client` read `CONSOLE_DATABASE_URL`; hand them the
  // test database. This is the only place assignment to `CONSOLE_DATABASE_URL`
  // may happen during a test run.
  process.env.CONSOLE_DATABASE_URL = testUrl
}
