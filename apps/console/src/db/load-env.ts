/**
 * Which env file a console script reads, and in what order.
 *
 * It used to be decided per script: `drizzle.config.ts` read `.env.local` then
 * the monorepo root, `seed.ts` and `role.ts` read `.env` then the root and
 * never saw `.env.local` at all, and `seed-radar.ts` read all three in a third
 * order. The practical failure was `pnpm db:role` — the command an operator
 * runs to promote the first admin on a fresh database — reporting a missing
 * `CONSOLE_DATABASE_URL` on a machine where `.env.local` had it all along,
 * because that is the file `.env.example` tells you to fill in.
 *
 * Precedence matches `drizzle.config.ts`: the app's own file first, so a
 * migration and the scripts that follow it see the same database. The
 * monorepo root comes last, where it belongs — it is the fallback for
 * shared values, not the definition of this app's.
 *
 * `override: false` also means a value already in `process.env` (a real
 * environment variable, a `--env-file` passed to the runner) beats every file,
 * which is what a deployment that injects its configuration expects.
 */
import { existsSync } from "node:fs"
import { config } from "dotenv"

const CANDIDATES = [".env.local", ".env", "../../.env"]

export function loadConsoleEnv(): void {
  for (const path of CANDIDATES) {
    if (existsSync(path)) config({ path, override: false })
  }
}
