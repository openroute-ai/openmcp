import { z } from "zod"

/**
 * Validated environment for the GitHub data-sync domain.
 *
 * The rest of the app reads `process.env` inline (see `lib/auth.ts`,
 * `lib/redis.ts`). The sync domain touches far more secrets and runs
 * unattended, so every value it depends on is declared here and resolved
 * once. Grouped accessors let each integration degrade independently: a
 * missing translation provider disables translation without failing the
 * whole domain, whereas a missing `GITHUB_ACCESS_TOKEN` disables the
 * domain outright because nothing works without it.
 */

const emptyToUndefined = (value: unknown) =>
  value === "" || value === undefined ? undefined : value

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().optional()
)

const optionalUrl = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined
      try {
        return new URL(value)
      } catch {
        return undefined
      }
    })
)

const optionalList = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
)

const optionalNumber = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    })
)

/** Reads a variable lazily so tests can stub `process.env` after import. */
const envSchema = {
  GITHUB_ACCESS_TOKEN: optionalString,
  CONSOLE_API_TOKEN: optionalString,
  CRON_SECRET: optionalString,

  GITHUB_DATA_WEBHOOK_URL: optionalList,
  GITHUB_DATA_WEBHOOK_SECRET: optionalString,

  WEEKLY_WEBHOOK_URL: optionalString,
  MONTHLY_WEBHOOK_URL: optionalString,
  DAILY_WEBHOOK_TOKEN: optionalString,

  SKILLS_WEBHOOK_URL: optionalString,
  SKILLS_WEBHOOK_TOKEN: optionalString,

  FRONTEND_BUILD_WEB_HOOK: optionalString,
  API_TRIGGER_BUILD_WEBHOOK_URL: optionalString,
  RANKINGS_ROOT_URL: optionalUrl,

  WEWORK_WEBHOOK_URL: optionalString,
  WEWORK_CORPID: optionalString,
  WEWORK_CORPSECRET: optionalString,
  WEWORK_AGENTID: optionalNumber,
  WEWORK_TOPARTY: optionalString,
  WEWORK_TOTAG: optionalString,
  WEWORK_TOUSER: optionalString,

  DISCORD_MONTHLY_WEBHOOK: optionalString,
  SLACK_WEBHOOK_URL: optionalString,

  AZURE_TRANSLATOR_KEY: optionalString,
  AZURE_TRANSLATOR_REGION: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalUrl,
  OPENAI_MODEL: optionalString,
  DEEPSEEK_API_KEY: optionalString,
  DEEPSEEK_BASE_URL: optionalUrl,
  DEEPSEEK_MODEL: optionalString,
  OLLAMA_BASE_URL: optionalUrl,
  OLLAMA_MODEL: optionalString,

  ALIYUN_ACCESS_KEY_ID: optionalString,
  ALIYUN_ACCESS_KEY_SECRET: optionalString,
  ALIYUN_OSS_BUCKET: optionalString,
  ALIYUN_OSS_REGION: optionalString,
}

export type SyncEnv = {
  [K in keyof typeof envSchema]: z.output<(typeof envSchema)[K]>
}

let cached: SyncEnv | undefined

/**
 * Parses the sync-domain variables. Cached after the first success so a
 * long-running scheduler does not re-validate on every task.
 */
export function syncEnv(): SyncEnv {
  if (cached) return cached

  const parsed: Record<string, unknown> = {}
  for (const [key, schema] of Object.entries(envSchema)) {
    parsed[key] = schema.parse(process.env[key])
  }
  cached = parsed as SyncEnv
  return cached
}

/** Test seam: drops the memoised parse. */
export function resetSyncEnvCache() {
  cached = undefined
}

/**
 * The GitHub token every REST/GraphQL call needs. Throws rather than
 * falling back to an unauthenticated request: the anonymous limit is 60
 * requests/hour, which a single sync run blows through, and it silently
 * returns different data for private repositories.
 */
export function requireGitHubToken(): string {
  const token = syncEnv().GITHUB_ACCESS_TOKEN
  if (!token) {
    throw new Error(
      "GITHUB_ACCESS_TOKEN is not set. See apps/console/.env.example."
    )
  }
  return token
}

/**
 * The bearer token for the machine-to-machine ingest API, if one is set.
 *
 * The ingest route fails closed on `undefined` rather than rejecting every
 * call: an instance with no token configured does not expose the route at
 * all, so an unauthenticated probe cannot confirm it exists.
 */
export function apiToken(): string | undefined {
  return syncEnv().CONSOLE_API_TOKEN
}

/**
 * True when the scheduler endpoint should be mounted. The endpoint fails
 * closed: with no secret configured it is not exposed at all, because
 * `CRON_SECRET` unset must never degrade into an unauthenticated trigger
 * for jobs that write to the database and push webhooks.
 */
export function cronSecret(): string | undefined {
  return syncEnv().CRON_SECRET
}

export function hasAliyunOss(): boolean {
  const env = syncEnv()
  return Boolean(
    env.ALIYUN_ACCESS_KEY_ID &&
      env.ALIYUN_ACCESS_KEY_SECRET &&
      env.ALIYUN_OSS_BUCKET &&
      env.ALIYUN_OSS_REGION
  )
}

export function hasAzureTranslator(): boolean {
  const env = syncEnv()
  return Boolean(env.AZURE_TRANSLATOR_KEY && env.AZURE_TRANSLATOR_REGION)
}

/** The chat model backing AI translation; the first configured one wins. */
export function aiProvider() {
  const env = syncEnv()
  if (env.OPENAI_API_KEY && env.OPENAI_BASE_URL) {
    return {
      kind: "openai" as const,
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
      model: env.OPENAI_MODEL ?? "gpt-4o-mini",
    }
  }
  if (env.DEEPSEEK_API_KEY) {
    return {
      kind: "openai" as const,
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: env.DEEPSEEK_BASE_URL ?? new URL("https://api.deepseek.com/v1"),
      model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
    }
  }
  if (env.OLLAMA_BASE_URL) {
    return {
      kind: "openai" as const,
      apiKey: "ollama",
      baseURL: env.OLLAMA_BASE_URL,
      model: env.OLLAMA_MODEL ?? "qwen3",
    }
  }
  return undefined
}
