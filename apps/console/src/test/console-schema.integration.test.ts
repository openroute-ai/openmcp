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
import { getTableConfig } from "drizzle-orm/pg-core"
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
  it("is the twenty-nine tables console owns", () => {
    // Four better-auth + one submission + one API key + twenty-three GitHub. If
    // this list changes, the count changes with it, and the diff is the review.
    expect(managedTables).toHaveLength(29)
    expect(managedTables).toEqual(
      [
        "account",
        "api_keys",
        "bundles",
        "capabilities",
        "hall_of_fame",
        "hall_of_fame_to_projects",
        "packages",
        "project_skills",
        "project_sync_jobs",
        "projects",
        "projects_to_capabilities",
        "projects_to_tags",
        "readme_sync_jobs",
        "repo_daily_stats",
        "repo_monthly_stats",
        "repo_stargazers",
        "repo_weekly_stats",
        "repos",
        "rising_star_categories",
        "rising_star_projects",
        "session",
        // Declared, never written. `0012` copied its rows into
        // `repo_monthly_stats` but kept the table so the copy stays
        // replayable and so `drizzle-kit push` cannot offer to drop 748 rows it
        // has no permission to drop. Its presence in *this* list is what makes
        // that true -- an undeclared table is an unmanaged one.
        "snapshots",
        "tags",
        "task_definitions",
        "task_executions",
        "task_status",
        "user",
        "user_repos",
        "verification",
      ].sort()
    )
  })

  it("keeps `snapshots` declared so push cannot propose dropping its rows", () => {
    // The failure this guards against is quiet: `push` reads the declarations,
    // so a table missing from them is a table `push` believes it should delete.
    // Nothing in the app would notice -- no service reads it -- and the damage
    // is 748 rows of the input `0012`'s INSERTs read from.
    expect(managedTables).toContain("snapshots")
    const { primaryKeys } = getTableConfig(managed.snapshots)
    expect(
      Object.values(primaryKeys).flatMap((key) =>
        key.columns.map((column) => column.name)
      )
    ).toEqual(["repo_id", "year"])
  })

  it("gives `user_repos` the columns the submission split reads", () => {
    // The public and private halves of a submission are separated by column name
    // rather than by privilege on one set of columns, so a column added to the
    // wrong half is a leak that only surfaces as a TypeScript error far from the
    // mistake. Naming both groups here means the error lands where it is made.
    const columns = Object.values(getTableColumns(managed.userRepos)).map(
      (c) => c.name
    )
    expect(columns).toEqual(
      expect.arrayContaining([
        // Public: who submitted it, when, and what the platform did about it.
        "source",
        "submitted_at",
        "platform_status",
        "platform_synced_at",
        // Private: this account's own disposition of its own submission.
        "status",
        "note",
        "pinned",
        "last_viewed_at",
        "updated_at",
      ])
    )

    // The pair is the primary key, not a surrogate id: an account submits a given
    // repository at most once, and submitting it again has to update that row
    // rather than create a second one.
    //
    // Read through `getTableConfig` rather than by filtering `getTableColumns` on
    // `.primary`: the key spans two columns and is declared as a table-level
    // `primaryKey({ columns })`, so neither column is marked primary on its own
    // and that filter finds nothing at all.
    const { primaryKeys } = getTableConfig(managed.userRepos)
    expect(
      Object.values(primaryKeys).flatMap((key) =>
        key.columns.map((column) => column.name)
      )
    ).toEqual(["user_id", "repo_id"])
  })

  it("excludes the shared schema's tables", () => {
    // These belong to web/api and must never appear in console's migrations.
    // `src/db/schema.ts` no longer imports `@workspace/db` at all, so the
    // guard is now against a regression that would reintroduce that import
    // and hand drizzle-kit web's 86 tables.
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

  it("manages console's `user`, the one carrying role and the ban columns", () => {
    // Console declares its own `user` rather than importing the shared one, and
    // it has to carry the columns better-auth's admin plugin and the role checks
    // read. A migration generated from the shared definition would lack them.
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

  it("has migrations that between them create all of them", () => {
    const journal = JSON.parse(
      readFileSync(join(process.cwd(), "src/db/drizzle/meta/_journal.json"), "utf8")
    ) as { entries: { tag: string }[] }
    // `0000`–`0008` were squashed into one baseline; see README "Migrations are
    // a single squashed baseline" for why the incremental history was
    // discarded. Everything after it is an ordinary migration, so the assertion
    // covers the whole set rather than the baseline alone: a table added after
    // the squash is created by a later file, and demanding the baseline create
    // it would fail the first migration anyone writes after a squash.
    expect(journal.entries.length).toBeGreaterThanOrEqual(1)

    const sqlText = journal.entries
      .map((entry) =>
        readFileSync(
          join(process.cwd(), "src/db/drizzle", `${entry.tag}.sql`),
          "utf8"
        )
      )
      .join("\n")
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
    // schema it does not have. One row per journal entry is correct: more means
    // stale, fewer means the database is behind the checked-in migrations.
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

    const journal = JSON.parse(
      readFileSync(join(process.cwd(), "src/db/drizzle/meta/_journal.json"), "utf8")
    ) as { entries: unknown[] }

    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`
    )
    expect(rows[0]?.n).toBe(journal.entries.length)
  }, NETWORK_BUDGET_MS)

  it("issues the session query every protected page issues", async () => {
    // The check that actually catches a missing `session` table: the one that
    // returned `relation "session" does not exist` before.
    const result = await db.execute(sql`select count(*)::int as n from session`)
    expect(result).toBeDefined()
  }, NETWORK_BUDGET_MS)
})
