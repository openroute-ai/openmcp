/**
 * Seeds the task definitions a fresh database needs.
 *
 * The definitions are normally created by `seedDefinitions` on the first Cron
 * tick, so this script is only for bootstrapping a database before it is
 * deployed — after it, the task rows can be edited from the dashboard, and
 * seeding stays insert-only so an operator's schedule change is never
 * reverted by a later run.
 */

import { config } from "dotenv"
import { count } from "drizzle-orm"

config({ path: ".env" })
config({ path: "../../.env", override: false })

async function main() {
  if (!process.env.CONSOLE_DATABASE_URL) {
    throw new Error("CONSOLE_DATABASE_URL is required to run the seed script")
  }

  const { db, pool } = await import("./client")
  const { taskDefinitions } = await import("./schema")
  const { seedDefinitions } = await import("../lib/tasks/seed")

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(taskDefinitions)

  await seedDefinitions()

  const [{ total: after } = { total: 0 }] = await db
    .select({ total: count() })
    .from(taskDefinitions)

  console.log(
    `task definitions: ${total} before, ${after} after` +
      (after === total ? " (nothing missing)" : "")
  )

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
