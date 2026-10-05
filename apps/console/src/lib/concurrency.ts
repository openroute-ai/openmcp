/**
 * Runs an async task over every item with a ceiling on how many are in flight,
 * and returns the results in input order.
 *
 * The ingest path reads one document per skill directory and translates each of
 * them, so a repository like `vercel-labs/open-agents` turns a dozen round trips
 * into a couple of hundred. Done one at a time that took minutes, which is longer
 * than a caller waiting on the answer — done all at once it would spend a
 * repository's whole GitHub budget and its whole rate-limit budget on one sync.
 * The ceiling is what makes it safe to go faster without going unbounded.
 *
 * Order is part of the contract rather than an accident: callers store results
 * against the skills they came from, so a result may not drift to a different
 * index just because a later item happened to finish first.
 *
 * Rejection behaves like `Promise.all`: the first task to reject rejects the
 * whole call, and the tasks still running are left to settle on their own.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  if (!Number.isFinite(limit) || limit < 1) {
    throw new RangeError(`limit must be a positive number, got ${limit}`)
  }

  const results: R[] = new Array(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index] as T, index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.floor(limit), items.length) }, worker)
  )

  return results
}
