/**
 * Codes for the outcomes the interface translates.
 *
 * The server talks in codes and the client turns them into the reader's
 * language, because a string that arrives from the server has already been
 * written in one language and no amount of formatting makes it another. A
 * reason like "task is already running" is also the message that ends up in a
 * CLI log and in the webhook's JSON response, where English is right, so the
 * prose stays where it belongs and the code travels alongside it.
 *
 * A code the client does not know is not an error: the prose is the fallback,
 * so a new skip reason degrades to English in a toast rather than rendering
 * the code itself.
 */

/** Thrown as a `TRPCError` cause, and carried to the client as `appCode`. */
export const ERROR_CODES = {
  /** The task disappeared between listing it and clicking run. */
  taskNotFound: "task.notFound",
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * Why a run returned `skipped` rather than doing the work.
 *
 * A task adds a code here when its skip reason is worth reading in the
 * interface. One it does not add stays prose-only, which reaches the toast in
 * English — the cost of a code is a message in every catalog, so it is only
 * worth one where the reason is something an operator would want explained.
 */
export const SKIP_CODES = {
  taskDisabled: "task.disabled",
  taskAlreadyRunning: "task.alreadyRunning",
  /** The webhook's per-minute throttle, which has no interface. */
  alreadyRanThisMinute: "task.alreadyRanThisMinute",
  noDataForPeriod: "task.noDataForPeriod",
  noDataForYear: "task.noDataForYear",
  missingNotifyWebhook: "task.missingNotifyWebhook",
} as const

export type SkipCode = (typeof SKIP_CODES)[keyof typeof SKIP_CODES]

const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown
): value is T => typeof value === "string" && values.includes(value as T)

export const isErrorCode = (value: unknown): value is ErrorCode =>
  isOneOf(Object.values(ERROR_CODES), value)

export const isSkipCode = (value: unknown): value is SkipCode =>
  isOneOf(Object.values(SKIP_CODES), value)
