import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { schema } from "./schema"
import { resolveSsl } from "./ssl"

/**
 * Constructs the pool; `pg` opens no connection until the first query, so
 * importing this module is safe during `next build` when no database
 * credentials are present. A missing `CONSOLE_DATABASE_URL` surfaces on the
 * first query instead of breaking every route at build time.
 *
 * Sized for a serverless deployment: connection limits are per-instance and
 * Vercel may hold several instances warm at once, so the pool is kept small
 * and connections are returned quickly rather than held open.
 */
function createPool(): Pool {
  return new Pool({
    connectionString: process.env.CONSOLE_DATABASE_URL,
    max: Number(process.env.CONSOLE_DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: resolveSsl(process.env.CONSOLE_DATABASE_URL),
  })
}

const globals = globalThis as typeof globalThis & { __consolePool?: Pool }

/**
 * The dev server gets one pool for the whole process, not one per recompile.
 *
 * Module scope does not survive a dev-server recompile, so without this every
 * save that touched an imported module ran the module body again and built
 * another `Pool` — each opening its own connections up to `max` against the
 * same database, while the previous pool's sockets stayed open until their
 * idle timeout because nothing ever calls `pool.end()` on them. A hosted pooler
 * counts connections per project, so the pile-up ends in
 * `timeout exceeded when trying to connect` on a page whose individual queries
 * are all fast.
 *
 * Production keeps the plain module constant: a serverless instance imports
 * this module once and `globalThis` buys it nothing, while the scripts that
 * call `pool.end()` expect to own the pool they end.
 */
export const pool =
  process.env.NODE_ENV === "production"
    ? createPool()
    : (globals.__consolePool ??= createPool())

export const db = drizzle({ client: pool, schema })

export type Database = typeof db

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0]
