import { schema } from "@workspace/db"
import { betterAuth } from "better-auth"
import type { BetterAuthOptions } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { AUTH_PATH } from "./constants"
import { sharedAuthOptions } from "./options"
import type { RateLimitStorage } from "./rate-limit"

type DrizzleDatabase = Parameters<typeof drizzleAdapter>[0]

/**
 * The tables Better Auth reads, taken from the shared schema so a rename there
 * is a compile error here rather than a runtime `SCHEMA_MISMATCH`.
 *
 * The override is typed as "these tables, plus whatever else the app defines"
 * rather than `Partial<typeof schema>`: an app with its own tables can only
 * satisfy the latter if every one of its tables also exists in the shared
 * schema, which is false for `apps/console`, which brings its own `repos` and
 * `snapshots`. The extra keys are carried as `unknown` because the adapter
 * accepts an arbitrary record and only ever indexes the four names above.
 */
type BetterAuthTables = Pick<
  typeof schema,
  "session" | "account" | "verification"
>

/**
 * `user` is typed structurally rather than as the shared `user`, because an app
 * is allowed to declare its own: `apps/console` keeps a local table that adds
 * the phoneNumber columns, and it is a deliberate *subset* of the shared one
 * (it omits `banned`, `banReason`, `banExpires` and `customerId`). Requiring an
 * exact match would reject that.
 *
 * `object` rather than the shared table type: this package has no direct
 * dependency on `drizzle-orm` (only a transitive one via `@workspace/db`), so
 * naming `AnyPgTable` would mean adding a dependency for a single type. The
 * constraint that matters is only that `user` is a table object the adapter can
 * index at runtime; which columns it carries is validated by Better Auth itself
 * and surfaces as `SCHEMA_MISMATCH` rather than at compile time.
 */
export type AuthSchema = BetterAuthTables & {
  user: object
} & Record<string, unknown>

export type CreateAuthOptions = {
  baseURL: string
  secret: string
  trustedOrigins?: string[]
  /** Better Auth advanced options, e.g. `{ ipAddress: { ipAddressHeaders } }`. */
  advanced?: BetterAuthOptions["advanced"]
  /**
   * Enables Better Auth's rate limiter backed by `storage`. When the
   * `storage` is a Redis limiter the counters are shared across replicas.
   * `window` (seconds) and `max` apply to the default per-IP bucket; the
   * stricter built-in sign-in/sign-up rules always apply on top.
   */
  rateLimit?: {
    enabled?: boolean
    window?: number
    max?: number
    storage: RateLimitStorage
  }
  /** OAuth social providers, e.g. `{ github: { clientId, clientSecret } }`. */
  socialProviders?: BetterAuthOptions["socialProviders"]
  /**
   * Extra Better Auth plugins. One whose `id` matches a shared plugin's
   * replaces it rather than registering a second copy of the same endpoints;
   * see `mergePlugins`.
   */
  plugins?: BetterAuthOptions["plugins"]
  /**
   * Override the drizzle schema used by the adapter. Apps extending the
   * shared user table (e.g. phone number columns) can pass their own table.
   */
  schema?: AuthSchema
}

/**
 * Merges the shared plugin list with the app's, letting the app *replace* a
 * shared plugin rather than stack a second copy of it.
 *
 * Better Auth resolves plugin endpoints by spreading `plugin.endpoints` in
 * array order, so a plugin registered twice registers the same paths twice: the
 * second copy wins the route, the first is dead, and Better Auth logs an
 * `Endpoint path conflicts detected!` error naming both copies of the same id.
 * That is a warning, not a failure, which makes it easy to leave in place — and
 * the copy that wins is whichever happens to be last in the array, so a
 * reordering that is otherwise invisible can silently swap which `sendOTP`
 * runs. For `phone-number` that is the difference between the real SMS gateway
 * with its captcha and rate limits, and a stub that writes the one-time
 * password to the log.
 *
 * Deduplicating by `id` makes the app's copy authoritative instead, and makes
 * the outcome independent of ordering. An app that only wants to *add* a plugin
 * the shared list does not have is unaffected.
 */
function mergePlugins(
  shared: BetterAuthOptions["plugins"],
  own: BetterAuthOptions["plugins"]
): NonNullable<BetterAuthOptions["plugins"]> {
  const merged = [...(shared ?? [])]
  for (const plugin of own ?? []) {
    // Only deduplicate on a real id. `undefined === undefined` would make two
    // distinct id-less plugins look like the same plugin, and the second would
    // silently replace the first.
    if (plugin.id === undefined) {
      merged.push(plugin)
      continue
    }
    const index = merged.findIndex(
      (existing) => existing.id !== undefined && existing.id === plugin.id
    )
    if (index === -1) {
      merged.push(plugin)
    } else {
      merged[index] = plugin
    }
  }
  return merged
}

export function createAuth(
  database: DrizzleDatabase,
  options: CreateAuthOptions
) {
  const rateLimit = options.rateLimit?.storage
    ? {
        enabled: options.rateLimit.enabled ?? true,
        ...(options.rateLimit.window != null
          ? { window: options.rateLimit.window }
          : {}),
        ...(options.rateLimit.max != null
          ? { max: options.rateLimit.max }
          : {}),
        customStorage: options.rateLimit.storage,
      }
    : undefined

  return betterAuth({
    ...sharedAuthOptions,
    basePath: AUTH_PATH,
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins ?? [],
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: options.schema ?? schema,
    }),
    plugins: mergePlugins(sharedAuthOptions.plugins, options.plugins),
    ...(options.advanced ? { advanced: options.advanced } : {}),
    ...(options.socialProviders
      ? { socialProviders: options.socialProviders }
      : {}),
    ...(rateLimit ? { rateLimit } : {}),
  })
}
