/**
 * Runs a task from the command line.
 *
 * The Cron endpoint is the production entrypoint; this exists so a task can be
 * run by hand against a real database when something needs checking, without
 * waiting for its schedule or editing a schedule to make it due.
 *
 *   pnpm sync:run update-package-data
 *   pnpm sync:run update-bundle-size --force
 *   pnpm sync:run --list
 *
 * `--force` bypasses the task's database lock. That is a deliberate escape
 * hatch for an operator who knows a run is wedged, and it is not the default
 * because two concurrent runs of the same task write the same rows.
 */

import { config } from "dotenv"
import { db, pool } from "@/db/client"
import { TASK_SEEDS } from "@/lib/tasks/definitions"
import { installTaskRegistry, UNIMPLEMENTED_TASKS } from "@/lib/tasks/registry"
import { ensureTaskDefinition, listTaskDefinitions } from "@/lib/github/service/task"
import { createBufferingLogger, runTask } from "@/lib/tasks/runner"
import type { TaskDefinitionInput } from "@/lib/github/service/task"

interface Args {
  name?: string
  force: boolean
  list: boolean
  seed: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { force: false, list: false, seed: false }

  for (const arg of argv) {
    if (arg === "--force") args.force = true
    else if (arg === "--list" || arg === "-l") args.list = true
    else if (arg === "--seed") args.seed = true
    else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`)
    } else {
      args.name = arg
    }
  }

  return args
}

function seedFor(name: string): TaskDefinitionInput {
  const seed = TASK_SEEDS.find((candidate) => candidate.name === name)
  if (!seed) throw new Error(`No task named ${name} is seeded`)

  return {
    name: seed.name,
    description: seed.description,
    cronExpression: seed.cronExpression,
    taskType: seed.taskType,
    isDaily: seed.isDaily,
    isWeekly: seed.isWeekly,
    isMonthly: seed.isMonthly,
  }
}

async function main() {
  config()

  const args = parseArgs(process.argv.slice(2))
  const registry = installTaskRegistry()

  if (args.list) {
    for (const seed of TASK_SEEDS) {
      const status = UNIMPLEMENTED_TASKS.has(seed.name)
        ? "not implemented"
        : registry.has(seed.name)
          ? "ready"
          : "no implementation"
      console.log(
        `${seed.name.padEnd(26)} ${seed.cronExpression.padEnd(13)} ${status}`
      )
    }
    return
  }

  if (!args.name) {
    throw new Error("Pass a task name, or --list to see them all")
  }

  if (UNIMPLEMENTED_TASKS.has(args.name)) {
    throw new Error(`${args.name} has no implementation in this app`)
  }
  if (!registry.has(args.name)) {
    throw new Error(`No implementation registered for ${args.name}`)
  }

  // Seeding is insert-only, so a run against a schedule an operator changed
  // uses the stored one rather than the value in the code.
  const definition = args.seed
    ? await ensureTaskDefinition(db, seedFor(args.name))
    : (await listTaskDefinitions(db)).find(
        (candidate) => candidate.name === args.name
      ) ?? (await ensureTaskDefinition(db, seedFor(args.name)))

  const logger = createBufferingLogger()
  const outcome = await runTask(db, definition, {
    logger,
    triggeredBy: "manual",
    force: args.force,
  })

  console.log(`\n${args.name}: ${outcome.status}`)
  if (outcome.status === "failed") console.error(outcome.error)
  if (outcome.status === "skipped") console.error(`  ${outcome.reason}`)
  if (args.force) {
    console.log("  ran with --force: the task lock was bypassed")
  }

  // The status is what the exit code carries, so a scheduled run of this
  // script fails the build rather than printing a failure nobody reads.
  if (outcome.status === "failed") process.exitCode = 1
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    // Pool ended explicitly: the process would hang otherwise, waiting on
    // idle connections it has no more use for.
    void pool.end()
  })
