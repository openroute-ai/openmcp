/**
 * Guards the two schema facts that are invisible in TypeScript and only fail
 * at runtime.
 *
 * Both of these broke the app in the same way: a migration applied cleanly,
 * `tsc` passed, and the first request that touched the affected table returned
 * a Postgres error. The first is better-auth writing a column no migration ever
 * created (`42703 undefined_column` on the first sign-up). The second is
 * drizzle-kit managing a different table set than the app queries, which
 * produces a database that is quietly missing tables.
 *
 * The column list is better-auth's, not ours: `createSession()` builds its
 * INSERT from the library's own model, and those two columns are part of it
 * whether or not the organization and admin plugins are enabled. The
 * `@better-auth/cli` generator is not a substitute for checking this — it
 * resolves independently of the runtime and its published version lags, so it
 * omits columns the installed runtime writes.
 *
 * The table list is `src/db/drizzle-schema.ts`'s, asserted here because that
 * file is an explicit enumeration: a new table is silently unmanaged until it
 * is listed, and nothing warns.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getTableColumns, getTableName, is, sql, Table } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db, pool } from "@/db/client"
import * as managed from "@/db/drizzle-schema"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

/** Every table drizzle-kit is told to manage, straight from the entry point. */
const managedTables = Object.values(managed)
  .filter((value) => is(value, Table))
  .map((table) => getTableName(table))
  .sort()

describe("managed table set", () => {
  it("is the twenty-two tables console owns", () => {
    // Four better-auth + eighteen GitHub. If this list changes, the count
    // changes with it, and the diff is the review.
    expect(managedTables).toHaveLength(22)
    expect(managedTables).toEqual(
      [
        "account",
        "bundles",
        "hall_of_fame",
        "hall_of_fame_to_projects",
        "packages",
        "project_skills",
        "project_sync_jobs",
        "projects",
        "projects_to_tags",
        "readme_sync_jobs",
        "repo_weekly_stars",
        "repos",
        "rising_star_categories",
        "rising_star_projects",
        "session",
        "snapshots",
        "tags",
        "task_definitions",
        "task_executions",
        "task_status",
        "user",
        "verification",
      ].sort()
    )
  })

  it("excludes the shared schema's tables", () => {
    // `src/db/schema.ts` re-exports `@workspace/db/schema` wholesale, so these
    // are reachable from the app's own schema module. They belong to web/api
    // and must never appear in console's migrations.
    const shared = [
      "blog_posts",
      "workflows",
      "personas",
      "mcp_servers",
      "provider_earnings",
      "organization",
    ]
    for (const table of shared) {
      expect(managedTables, table).not.toContain(table)
    }
  })

  it("manages console's `user`, not the shared one", () => {
    // Both are `pgTable("user")`; drizzle keys tables by name, so the wrong
    // choice silently generates DDL without `role` or the ban columns.
    expect(managedTables).toContain("user")
    const columns = Object.values(getTableColumns(managed.user)).map((c) => c.name)
    expect(columns).toEqual(
      expect.arrayContaining([
        "role",
        "phone_number",
        "banned",
        "ban_reason",
        "ban_expires",
        "customer_id",
      ])
    )
  })

  it("has a baseline migration that creates all of them", () => {
    const journal = JSON.parse(
      readFileSync(join(process.cwd(), "src/db/drizzle/meta/_journal.json"), "utf8")
    ) as { entries: { tag: string }[] }
    // Squashed to one file; see README "Migrations are a single squashed
    // baseline" for why the incremental history was discarded.
    expect(journal.entries).toHaveLength(1)
    const [baseline] = journal.entries
    if (!baseline) throw new Error("journal has no baseline migration")

    const sqlText = readFileSync(
      join(process.cwd(), "src/db/drizzle", `${baseline.tag}.sql`),
      "utf8"
    )
    for (const table of managedTables) {
      expect(sqlText, table).toContain(`CREATE TABLE "${table}"`)
    }
  })
})

describe.runIf(hasDatabase)("live database", () => {
  /**
   * A statement against a managed provider is a network round trip, and the
   * first one also pays the TLS handshake and PgBouncer's own connect. That
   * measured 1.7s, which fits inside the 5s default only when nothing else
   * competes for the CPU — under load it does not, and the suite failed
   * intermittently on a timeout rather than on an assertion. The default
   * budget is for tests that fail fast; these are integration checks and get
   * one that matches what they are.
   */
  const NETWORK_BUDGET_MS = 20_000

  beforeAll(async () => {
    // Pay the connection cost once, in a hook with its own timeout, so the
    // per-test budget is spent on the query rather than the handshake.
    await db.execute(sql`select 1`)
  })

  afterAll(async () => {
    await pool.end()
  })

  it("has every table it manages", async () => {
    // The database may legitimately hold more — the local dev instance shares
    // one with apps/web — so this asserts the direction that matters: nothing
    // console manages is missing, which is the failure a stale migration
    // produces.
    const { rows } = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`
    )
    const present = rows.map((r) => r.table_name)
    for (const table of managedTables) {
      expect(present, table).toContain(table)
    }
  }, NETWORK_BUDGET_MS)

  it("has the columns better-auth writes to `session`", async () => {
    // The regression this exists for: better-auth 1.7.6's `createSession()`
    // INSERT lists both columns unconditionally, and their absence surfaced as
    // `column "active_organization_id" of relation "session" does not exist`
    // on the first sign-up of a freshly migrated database.
    const { rows } = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'session'`
    )
    const present = rows.map((r) => r.column_name)
    for (const column of [
      "id",
      "expires_at",
      "token",
      "created_at",
      "updated_at",
      "ip_address",
      "user_agent",
      "user_id",
      "active_organization_id",
      "impersonated_by",
    ]) {
      expect(present, column).toContain(column)
    }
  }, NETWORK_BUDGET_MS)

  it("has the columns the console's `user` role checks read", async () => {
    const { rows } = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'user'`
    )
    const present = rows.map((r) => r.column_name)
    for (const column of [
      "email",
      "role",
      "phone_number",
      "phone_number_verified",
      "banned",
      "ban_reason",
      "ban_expires",
      "customer_id",
    ]) {
      expect(present, column).toContain(column)
    }
  }, NETWORK_BUDGET_MS)

  it("records no applied migration that no longer exists", async () => {
    // Squashing the history left the ledger carrying rows for the eight
    // deleted migrations, and `db:migrate` reads the ledger before it decides
    // what to apply — so a stale row is how a database ends up claiming a
    // schema it does not have. One row is correct; more means stale.
    //
    // A missing ledger is legitimate: `drizzle-kit push` creates the tables
    // without one, and the local dev database was built that way. Nothing can
    // be stale in a database that never recorded a migration. The existence
    // check is a separate statement because the planner resolves the table
    // name when it parses the query, not when it evaluates the branch.
    const { rows: found } = await db.execute<{ present: string | null }>(
      sql`select to_regclass('drizzle.__drizzle_migrations')::text as present`
    )
    if (!found[0]?.present) return

    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`
    )
    expect(rows[0]?.n).toBe(1)
  }, NETWORK_BUDGET_MS)

  it("issues the session query every protected page issues", async () => {
    // The check that actually catches a missing `session` table: the one that
    // returned `relation "session" does not exist` before.
    const result = await db.execute(sql`select count(*)::int as n from session`)
    expect(result).toBeDefined()
  }, NETWORK_BUDGET_MS)
})
