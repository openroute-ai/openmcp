import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { schema } from "./schema"
import { resolveSsl } from "./ssl"

/**
 * The pool is constructed eagerly, but `pg` does not open a connection until
 * the first query, so importing this module is safe during `next build` when
 * no database credentials are present. A missing `CONSOLE_DATABASE_URL`
 * surfaces on the first query instead of breaking every route at build time.
 *
 * Sized for a serverless deployment: connection limits are per-instance and
 * Vercel may hold several instances warm at once, so the pool is kept
 * small and connections are returned quickly rather than held open.
 */
export const pool = new Pool({
  connectionString: process.env.CONSOLE_DATABASE_URL,
  max: Number(process.env.CONSOLE_DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: resolveSsl(process.env.CONSOLE_DATABASE_URL),
})

export const db = drizzle({ client: pool, schema })

export type Database = typeof db

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0]
