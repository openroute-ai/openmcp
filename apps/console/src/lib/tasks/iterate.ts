/**
 * Bounded, failure-isolated iteration over database rows.
 *
 * Replaces the source app's `ItemProcessor` class hierarchy. Those classes
 * each answered "which ids", "load one" and "name one", which is a
 * class-per-entity pattern rather than a behavioural one; a function taking a
 * loader and a label covers every entity without a subclass per table.
 *
 * The two properties the source relied on are kept:
 *
 * - Concurrency is bounded, so a sweep over thousands of repositories cannot
 *   open thousands of sockets and trip the GitHub or npm rate limits.
 * - One item failing does not fail the run. A deleted repository or a package
 *   that has been unpublished must not stop the other 499 from refreshing, so
 *   the error is recorded against that item and the loop continues.
 */

import type { TaskLogger } from "@/lib/tasks/runner"

export type MetaValue = boolean | number | undefined

/** What one item contributes; `true` counts as one. */
export type Meta = Record<string, MetaValue>

/** The run's totals, always numeric so a caller can report them directly. */
export type MetaTotals = Record<string, number>

export interface ItemResult<T> {
  /** Collected into the run's totals; `data` is dropped when null. */
  meta: Meta
  data: T | null
}

export interface LoopOptions {
  concurrency?: number
  /** Minimum gap between two mapper calls, to stay under a rate limit. */
  throttleIntervalMs?: number
}

const DEFAULT_CONCURRENCY = 5
const DEFAULT_THROTTLE_MS = 0

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Maps a meta value onto the number it contributes to a total. */
function toNumber(value: MetaValue): number {
  if (!value) return 0
  return value === true ? 1 : value
}

/**
 * Sums per-item meta into run totals.
 *
 * `true` counts as one so a task can report "how many needed updating"
 * without also tracking a separate number for the same thing.
 */
export function aggregateMeta(
  results: Iterable<ItemResult<unknown>>
): MetaTotals {
  const totals: Record<string, number> = {}

  for (const result of results) {
    for (const [key, value] of Object.entries(result.meta)) {
      const amount = toNumber(value)
      totals[key] = (totals[key] ?? 0) + amount
    }
  }

  return totals
}

export interface LoopResult<T> {
  meta: MetaTotals
  data: T[]
  /** Items that threw, for the log line the caller writes. */
  errors: Error[]
  durationMs: number
}

/**
 * Runs `mapper` over every item, at bounded concurrency.
 *
 * A minimum interval is enforced across the whole loop rather than per
 * worker: a per-worker interval would multiply the effective rate by the
 * concurrency and defeat the limit it is meant to enforce.
 */
export async function processItems<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<ItemResult<R>>,
  options: LoopOptions & { logger: TaskLogger; label: string }
): Promise<LoopResult<R>> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const interval = options.throttleIntervalMs ?? DEFAULT_THROTTLE_MS
  const started = Date.now()

  const results: ItemResult<R>[] = new Array(items.length)
  const errors: Error[] = []
  let next = 0

  // Start gate. Every caller's delay is appended to one shared chain, so
  // starts are spaced by at least `interval` across the whole loop. A
  // per-worker interval would multiply the effective rate by the concurrency
  // and defeat the limit it exists to enforce.
  let tail: Promise<void> = Promise.resolve()

  function waitForSlot(): Promise<void> {
    const slot = tail.then(() => delay(interval))
    // A rejected delay must not poison the chain for later callers, so the
    // chain advances on a swallowed copy while the caller still sees it.
    tail = slot.catch(() => {})
    return slot
  }

  async function worker(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return

      // The bound check above is what guarantees this index is in range;
      // without the assertion the read widens to `T | undefined`.
      const item = items[index] as T
      await waitForSlot()

      try {
        results[index] = await mapper(item, index)
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error))
        errors.push(failure)
        options.logger.error(
          `error processing ${options.label} #${index + 1}`,
          failure
        )
        // A null data keeps it out of the collected output while the error
        // still shows up in the counts, so a run cannot look fully successful.
        results[index] = { meta: { error: true }, data: null }
      }
    }
  }

  const workerCount = Math.min(concurrency, Math.max(items.length, 1))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const durationMs = Date.now() - started
  const data = results.flatMap((result) =>
    result.data === null || result.data === undefined ? [] : [result.data]
  )

  options.logger.info(
    `processed ${items.length} ${options.label}(s) in ${durationMs}ms` +
      (items.length > 0
        ? ` (avg ${Math.round(durationMs / items.length)}ms)`
        : "")
  )

  return { meta: aggregateMeta(results), data, errors, durationMs }
}
