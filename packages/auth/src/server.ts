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
  "user" | "session" | "account" | "verification"
>

export type AuthSchema = BetterAuthTables & Record<string, unknown>

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
  /** Extra Better Auth plugins merged on top of the shared ones. */
  plugins?: BetterAuthOptions["plugins"]
  /**
   * Override the drizzle schema used by the adapter. Apps extending the
   * shared user table (e.g. phone number columns) can pass their own table.
   */
  schema?: AuthSchema
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
    plugins: [...(sharedAuthOptions.plugins ?? []), ...(options.plugins ?? [])],
    ...(options.advanced ? { advanced: options.advanced } : {}),
    ...(options.socialProviders
      ? { socialProviders: options.socialProviders }
      : {}),
    ...(rateLimit ? { rateLimit } : {}),
  })
}
