/**
 * Creates any missing task definition.
 *
 * Runs on every tick (and every webhook trigger) rather than from a migration,
 * so adding a task is a code change rather than a coordinated deploy of a
 * migration and a scheduler.
 *
 * Insert-only, deliberately. An existing definition is left exactly as stored,
 * which is what preserves an operator's schedule change and their enabled
 * flag: seeding on every tick through an upsert would revert both to whatever
 * the code shipped with, minutes after anyone edited them.
 */

import { db } from "@/db/client"
import { ensureTaskDefinition } from "@/lib/github/service/task"
import { TASK_SEEDS } from "@/lib/tasks/definitions"

export async function seedDefinitions() {
  for (const seed of TASK_SEEDS) {
    await ensureTaskDefinition(db, {
      name: seed.name,
      description: seed.description,
      cronExpression: seed.cronExpression,
      taskType: seed.taskType,
      isDaily: seed.isDaily,
      isWeekly: seed.isWeekly,
      isMonthly: seed.isMonthly,
    })
  }
}
