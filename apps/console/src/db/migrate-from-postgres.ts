/**
 * Copies the legacy `postgres` database into console's own database.
 *
 * Console used to read its repositories, projects and statistics out of the
 * shared database (`POSTGRES_URL`, the Supabase `postgres` database) before it
 * got a database of its own behind `CONSOLE_DATABASE_URL`. The two designs have
 * diverged since: console renamed `projects."repoId"` to `repo_id` and
 * `packages."devDependencies"` to `dev_dependencies`, added columns the old
 * schema never had (`repos.type`, `override_*`, the `category_*` review trail),
 * and dropped nothing. So this is not a dump-and-restore — every table is read
 * column by column and written through the column list console declares, which
 * is also why the source schema is never modified: it is read through a
 * read-only connection as far as this script is concerned.
 *
 * What is copied is everything the source has except the scheduler:
 * `task_definitions`, `task_executions` and `task_status` stay where they are.
 * Console seeds its own definitions from `src/lib/tasks/seed.ts`, and the
 * execution history belongs to the machine that produced it.
 *
 * Rows already present in the target are left alone (`ON CONFLICT DO NOTHING`),
 * so an interrupted run can be resumed by running it again. The verification at
 * the end compares row counts against the source and fails loudly if anything
 * is short.
 *
 *   pnpm db:migrate:from-postgres
 *   CONSOLE_MIGRATE_SOURCE_URL=postgres://… pnpm db:migrate:from-postgres
 *
 * The source defaults to `POSTGRES_URL` from `.env.local`; the target is always
 * `CONSOLE_DATABASE_URL`.
 */

import { Pool } from "pg"
import { loadConsoleEnv } from "./load-env"
import { resolveSsl } from "./ssl"

loadConsoleEnv()

/** Rows per INSERT. Small enough to keep a batch of README text under any limit. */
const BATCH_SIZE = 50

type TableSpec = {
  table: string
  /** Source column name → console column name, where the designs spell them differently. */
  rename?: Record<string, string>
}

/**
 * Insertion order: a table only appears after every table its foreign keys
 * point at, so no constraint is ever checked against a missing parent.
 *
 * The scheduler tables are absent on purpose — see the header.
 */
const TABLES: TableSpec[] = [
  { table: "repos" },
  { table: "projects", rename: { repoId: "repo_id" } },
  { table: "tags" },
  { table: "snapshots" },
  { table: "packages", rename: { devDependencies: "dev_dependencies" } },
  { table: "bundles" },
  { table: "project_skills" },
  { table: "project_sync_jobs" },
  { table: "readme_sync_jobs" },
  { table: "projects_to_tags" },
  { table: "hall_of_fame" },
  { table: "hall_of_fame_to_projects" },
]

type Report = {
  table: string
  source: number
  targetBefore: number
  inserted: number
  skipped: string[]
  defaulted: string[]
}

/**
 * Opens a pool against a managed URL.
 *
 * `sslmode` is stripped first because `pg` lets it win over the `ssl` option,
 * and `pg-connection-string` reads `require` as `verify-full` — the
 * certificate check that fails without the provider's CA in the trust store.
 * `resolveSsl` makes the same localhost/remote decision the app itself makes.
 */
function connect(connectionString: string): Pool {
  const url = new URL(connectionString)
  url.searchParams.delete("sslmode")

  return new Pool({
    connectionString: url.toString(),
    ssl: resolveSsl(connectionString),
    max: 2,
    connectionTimeoutMillis: 15_000,
  })
}

async function columns(pool: Pool, table: string): Promise<string[]> {
  const { rows } = await pool.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [table]
  )
  return rows.map((row) => row.column_name)
}

async function rowCount(pool: Pool, table: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from "${table}"`
  )
  return Number(rows[0]?.count ?? 0)
}

/**
 * Reads one table as text.
 *
 * Every value is cast in the database rather than parsed in Node: `pg` hands
 * back `Date` objects for `timestamp` columns, and a `Date` round-trips through
 * `toISOString()`, which reinterprets a `timestamp without time zone` in the
 * server's offset. Reading text keeps `2024-01-01 00:00:00` exactly as stored,
 * and Postgres casts it back on the way in.
 */
async function readAll(
  pool: Pool,
  table: string,
  columnsToRead: string[]
): Promise<Record<string, string | null>[]> {
  if (columnsToRead.length === 0) return []
  const projection = columnsToRead
    .map((column) => `"${column}"::text as "${column}"`)
    .join(", ")
  const { rows } = await pool.query<Record<string, string | null>>(
    `select ${projection} from "${table}"`
  )
  return rows
}

async function copyTable(
  source: Pool,
  target: Pool,
  spec: TableSpec
): Promise<Report> {
  const { table, rename } = spec
  const sourceColumns = await columns(source, table)
  if (sourceColumns.length === 0) {
    throw new Error(
      `table "${table}" does not exist in the source database — nothing to copy from`
    )
  }
  const targetColumns = new Set(await columns(target, table))
  if (targetColumns.size === 0) {
    throw new Error(
      `table "${table}" does not exist in the target database — run "pnpm db:migrate" first`
    )
  }

  /** Source column → console column, for the columns the two designs share. */
  const projection: { from: string; to: string }[] = []
  /** Source columns console has no place for. */
  const skipped: string[] = []
  /** Console columns this copy leaves to their default. */
  const defaulted: string[] = []

  for (const column of sourceColumns) {
    const to = rename?.[column] ?? column
    if (targetColumns.has(to)) projection.push({ from: column, to })
    else skipped.push(column)
  }
  for (const column of targetColumns) {
    if (!projection.some((entry) => entry.to === column)) defaulted.push(column)
  }

  const targetBefore = await rowCount(target, table)
  const rows = await readAll(
    source,
    table,
    projection.map((entry) => entry.from)
  )

  let inserted = 0
  const targetNames = projection.map((entry) => entry.to)
  const insertColumns = targetNames.map((name) => `"${name}"`).join(", ")

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)
    const values: (string | null)[] = []
    const tuples = batch.map((row, index) => {
      const placeholders = projection.map((entry, column) => {
        values.push(row[entry.from] ?? null)
        return `$${index * projection.length + column + 1}`
      })
      return `(${placeholders.join(", ")})`
    })

    const result = await target.query(
      `insert into "${table}" (${insertColumns}) values ${tuples.join(", ")}
       on conflict do nothing`,
      values
    )
    inserted += result.rowCount ?? 0
  }

  return {
    table,
    source: rows.length,
    targetBefore,
    inserted,
    skipped,
    defaulted,
  }
}

function sourceUrlFromEnv(): string {
  const url =
    process.env.CONSOLE_MIGRATE_SOURCE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim()
  if (!url) {
    throw new Error(
      "Set CONSOLE_MIGRATE_SOURCE_URL (or POSTGRES_URL) to the source database"
    )
  }
  if (!process.env.CONSOLE_DATABASE_URL) {
    throw new Error("CONSOLE_DATABASE_URL is required to run this script")
  }
  if (url === process.env.CONSOLE_DATABASE_URL) {
    throw new Error(
      "Source and target are the same database — refusing to copy onto itself"
    )
  }
  return url
}

async function main(): Promise<void> {
  const source = connect(sourceUrlFromEnv())
  const target = connect(process.env.CONSOLE_DATABASE_URL as string)

  try {
    const reports: Report[] = []
    for (const spec of TABLES) {
      const report = await copyTable(source, target, spec)
      reports.push(report)
      console.log(
        `${report.table.padEnd(24)} ${String(report.source).padStart(6)} rows, ` +
          `${String(report.inserted).padStart(6)} inserted` +
          (report.skipped.length
            ? `, dropped: ${report.skipped.join(", ")}`
            : "") +
          (report.defaulted.length
            ? `, defaulted: ${report.defaulted.join(", ")}`
            : "")
      )
    }

    const short = reports.filter(
      (report) => report.targetBefore === 0 && report.inserted !== report.source
    )
    const stale = reports.filter((report) => report.targetBefore > 0)
    if (stale.length > 0) {
      console.log(
        `\nnot empty before this run (existing rows kept): ${stale
          .map((report) => report.table)
          .join(", ")}`
      )
    }
    if (short.length > 0) {
      throw new Error(
        `row count mismatch after copy: ${short
          .map(
            (report) => `${report.table} (${report.inserted}/${report.source})`
          )
          .join(", ")}`
      )
    }
    console.log(`\n${reports.length} tables copied into console's database`)
  } finally {
    await Promise.all([source.end(), target.end()])
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
