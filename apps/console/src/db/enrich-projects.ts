/**
 * One-off backfill: classify, tag and capability-fill every project.
 *
 * The scheduled `classify-projects` task works through the queue a batch at a
 * time and stops at whatever a human wants to review. An imported catalogue is
 * the other case: there is no queue worth working by hand, the decisions are
 * meant to publish immediately, and running the task's 50-per-run cap against
 * 500-odd projects by hand is not a workflow. So this drives the same per-project
 * work (`enrichProject`) to exhaustion:
 *
 *   1. derive and seed the capability vocabulary from the corpus;
 *   2. read the unreviewed projects, a batch at a time, and enrich each;
 *   3. stop when a full batch produces no new enrichment, which is when the
 *      queue is either empty or holds only projects that cannot be classified.
 *
 * It is idempotent and resumable. A project is taken out of the queue by being
 * enriched, so re-running continues where the last run stopped rather than
 * repeating it; a project that failed is attempted once per run and then left in
 * the queue for a human or a later run.
 *
 *   pnpm db:enrich
 */

import { loadConsoleEnv } from "./load-env"

loadConsoleEnv()

/** How many projects are read per round. */
const BATCH_SIZE = 50
/** How many model calls are in flight at once. */
const CONCURRENCY = 4
/**
 * A ceiling on rounds, so a bug that never enriches anything cannot spin. With
 * 50 per round this is far more than a catalogue of any plausible size needs.
 */
const MAX_ROUNDS = 200

interface Logger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

const logger: Logger = {
  info: (message, ...args) => console.log(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!)
    }
  })
  await Promise.all(runners)
  return results
}

async function main(): Promise<void> {
  if (!process.env.CONSOLE_DATABASE_URL) {
    throw new Error("CONSOLE_DATABASE_URL is required to run the backfill")
  }

  const { pool, db } = await import("./client")
  const { createChatModel } = await import("../lib/ai/provider")
  const {
    enrichProject,
    seedCapabilityVocabulary,
  } = await import("../lib/tasks/tasks/classify-projects")
  const { listCategories } = await import("../lib/github/service/category")
  const { listUnreviewedProjects } = await import("../lib/github/service/project")

  const model = createChatModel()
  if (!model) {
    throw new Error("No AI provider is configured (OPENAI_API_KEY / OPENAI_BASE_URL)")
  }

  const categories = await listCategories(db, { activeOnly: true })
  if (categories.length === 0) {
    throw new Error("No active categories exist; seed the taxonomy first")
  }

  console.log("seeding capability vocabulary from the corpus…")
  const { capabilities } = await seedCapabilityVocabulary(db)
  console.log(`capability vocabulary: ${capabilities.length} values`)

  const attempted = new Set<string>()
  let enriched = 0
  let failed = 0

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const batch = (await listUnreviewedProjects(db, { limit: BATCH_SIZE })).filter(
      (project) => !attempted.has(project.id)
    )
    if (batch.length === 0) break

    for (const project of batch) attempted.add(project.id)

    const outcomes = await mapPool(batch, CONCURRENCY, async (project) => {
      const outcome = await enrichProject(
        { db, model, categories, capabilities, logger },
        project
      )
      return outcome
    })

    let enrichedThisRound = 0
    for (const outcome of outcomes) {
      if (outcome.status === "enriched") {
        enrichedThisRound += 1
        enriched += 1
      } else {
        failed += 1
      }
    }

    console.log(
      `round ${round}: ${batch.length} attempted, ${enrichedThisRound} enriched ` +
        `(total ${enriched} enriched, ${failed} failed)`
    )

    if (enrichedThisRound === 0) break
  }

  console.log(`enriched ${enriched} projects, ${failed} could not be classified`)
  await pool.end()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
