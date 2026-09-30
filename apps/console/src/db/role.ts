/**
 * Promotes an account to `admin`, or demotes it back to `user`.
 *
 * The console has two audiences in one app, and the role decides which one an
 * account sees: `/dashboard` for an operator, `/console` for everyone else. The
 * column defaults to `user`, so every account that signs up lands on `/console`
 * and nobody can reach `/dashboard` until one is promoted. This is that step.
 *
 * A script rather than a dashboard page on purpose. The page that can hand out
 * `admin` is itself behind `admin`, so bootstrapping the first operator would
 * need a path that skips the check — and a path that skips an authorization
 * check is the thing to keep out of the request surface entirely. This runs
 * against the database with shell access instead.
 *
 * The role is the shared `user.role` column, so promoting here is visible to the
 * other apps without a second list to keep in step.
 *
 *   pnpm db:role -- <email>            promote to admin
 *   pnpm db:role -- <email> user       set the role explicitly
 *   pnpm db:role -- <email> --list     show the account's current role
 *
 * Matching is by email, case-insensitively: Better Auth normalises the address
 * on sign-up, so the stored value is not necessarily the one an operator types.
 */

import { config } from "dotenv"
import { eq } from "drizzle-orm"

config({ path: ".env" })
config({ path: "../../.env", override: false })

/** The roles this script writes. Anything else is a typo, not a new tier. */
const ROLES = ["admin", "user"] as const

type Role = (typeof ROLES)[number]

function usage(): never {
  console.error(
    [
      "usage:",
      "  pnpm db:role -- <email>              promote to admin",
      "  pnpm db:role -- <email> user         set the role explicitly",
      "  pnpm db:role -- <email> --list       show the account's current role",
    ].join("\n")
  )
  process.exit(1)
}

function parseArgs(argv: string[]): {
  email: string
  role: Role | "--list"
} {
  const positional = argv.filter((arg) => !arg.startsWith("-"))
  const flags = argv.filter((arg) => arg.startsWith("-"))

  if (flags.length > 1) usage()
  if (flags[0] && flags[0] !== "--list") usage()
  if (!positional[0]) usage()

  const requested = positional[1]
  if (flags[0] === "--list") {
    if (requested) usage()
    return { email: positional[0], role: "--list" }
  }

  // No second argument means the operator wants an admin, which is the only
  // promotion anyone asks for; demoting is spelled out rather than inferred.
  if (requested && !ROLES.includes(requested as Role)) usage()

  return { email: positional[0], role: (requested as Role) ?? "admin" }
}

async function main() {
  if (!process.env.CONSOLE_DATABASE_URL) {
    throw new Error(
      "CONSOLE_DATABASE_URL is required to run the role script"
    )
  }

  const { email, role } = parseArgs(process.argv.slice(2))
  const needle = email.trim().toLowerCase()

  const { db, pool } = await import("./client")
  const { user } = await import("./schema")

  const rows = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.email, needle))

  const account = rows[0]

  // Says so plainly rather than listing near-misses: a half-typed address is the
  // usual cause, and printing every account's email to help find it would turn a
  // typo into a way to enumerate registered users.
  if (!account) {
    throw new Error(`no account with the email ${needle}`)
  }

  if (role === "--list") {
    console.log(
      `${account.email}: ${account.role ?? "(null — treated as user)"}`
    )
    await pool.end()
    return
  }

  if (account.role === role) {
    console.log(`${account.email} is already ${role}`)
    await pool.end()
    return
  }

  await db.update(user).set({ role }).where(eq(user.id, account.id))

  console.log(`${account.email}: ${account.role ?? "(null)"} -> ${role}`)
  await pool.end()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
