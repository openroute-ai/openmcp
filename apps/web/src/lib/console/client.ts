/**
 * Client for `apps/console`, the GitHub data / sync domain this app shares
 * with it.
 *
 * console owns the repository, project, ranking and skill-document tables and
 * the tasks that keep them current. This app owns the marketplace: listings,
 * authors, purchases, wallets. The endpoints below are all machine-to-machine:
 *
 *   POST /api/v1/projects           create a project for a URL (publishes it)
 *   POST /api/v1/repos              register a URL for tracking (publishes nothing)
 *   GET  /api/skills-sync/export    page through synced skill documents
 *   POST /api/cron/github           run the console scheduler on demand
 *   POST /api/v1/skills/scan        run the security scanner on a repository
 *
 * The first one replaced `POST /api/internal/repos`, which authenticated on a
 * single site-wide `CONSOLE_API_TOKEN` and created a project as a side effect of
 * registering a repository. That endpoint is gone: registering and publishing
 * are now separate endpoints on separate scopes, so the credential this app
 * holds says exactly what it may do.
 *
 * `CONSOLE_API_KEY` is therefore required, and which scope it needs depends on
 * {@link consoleSubmitMode}. An operator issues it on console's
 * `/dashboard/api-keys`. It replaces `CONSOLE_API_TOKEN` /
 * `GITHUB_NEXTJS_API_TOKEN`, which are no longer read by either app.
 *
 * The skills export and the cron trigger keep their own tokens, because those
 * are separate credentials with separate blast radii: holding the export token
 * must not let a caller drive the scheduler. `SKILLS_WEBHOOK_TOKEN` and
 * `CRON_SECRET` stay distinct here for that reason.
 *
 * An unconfigured console is a normal single-app deployment, so
 * `consoleApiConfigured()` is how call sites ask before they try rather than
 * letting a 404 surface as a user-facing error.
 */

import { getBaseUrl } from "@/lib/urls/urls"
import type { SkillWebhookData } from "@/lib/skills/ingest-console-skill"
import type {
  LlmAnalysis,
  SecurityFlagHit,
  SecurityGrade,
  TrustTier,
} from "@workspace/security-scan"

/** How long an ordinary machine-to-machine call may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * A repository registration makes console fetch from GitHub, translate and
 * push a webhook before it answers, so it needs far longer than an ordinary
 * call. This is still a bound: a repository that cannot be read fails rather
 * than pinning the caller's request open.
 */
const INGEST_TIMEOUT_MS = 180_000

/** The project classification console creates for a registered repository. */
export type ConsoleProjectType =
  "application" | "skill" | "client" | "server" | "persona"

/**
 * What a repository submission to console is allowed to do.
 *
 * - `publish` — `POST /api/v1/projects`, which creates a project row and is
 *   therefore **publication**: the repository becomes visible on the public site
 *   and its skill documents are synced and pushed back here.
 * - `register` — `POST /api/v1/repos`, which writes only `repos` +
 *   `user_repos`. Nothing is published, and console never syncs or pushes the
 *   repository's skill documents, so nothing arrives here.
 *
 * The distinction is console's own (§1.4 of its open radar API design): the two
 * endpoints write different tables, sit behind different scopes, and differ in
 * visibility by an order of magnitude. This app picks between them at
 * deployment time rather than per submission.
 */
export type ConsoleSubmitMode = "publish" | "register"

export type ConsoleIngestResult = {
  ok: boolean
  /** `existing` when the repository already had a project on console. */
  status?: "created" | "existing"
  repo?: { full_name: string }
  project?: {
    id: string
    name: string
    slug: string
    type: string
    status: string
    description: string
  }
  /**
   * console 的技能同步结果。
   *
   * `empty` 是这里唯一能回答"这个仓库有没有技能文档"的字段：它为 true 表示
   * console 读了配置的那个路径而里面没有 `SKILL.md`。`count` 是它存下的数量，
   * 仓库被策展过更早时这一段是 `null`（本次调用没有再同步过）。
   */
  skills?: {
    count?: number
    translated?: number
    empty?: boolean
  } | null
  /**
   * 投递结果，与同步结果分开：console 存下的技能里有多少真的推到了本服务。
   *
   * 它回答的是"有没有东西被推过"，不是"有没有东西可推"——`found: 0` 配上
   * `delivered: true` 是自洽的，见 {@link consoleFoundNoSkills}。
   */
  delivery?: {
    found?: number
    pushed?: number
    failed?: number
    results?: Array<{ skillDir: string; pushed: boolean; summary: string }>
  } | null
  /**
   * Every stored skill reached this app's webhook.
   *
   * `null` means console had no `callbackUrl` for this project, which is a
   * deployment fact rather than a failed delivery - and `undefined` is the older
   * endpoints' way of saying the same thing.
   */
  delivered?: boolean | null
  message?: string
}

/**
 * console's answer to a registration that published nothing.
 *
 * A different shape from {@link ConsoleIngestResult} on purpose: there is no
 * project and no skill sync, so every field the publish answer carries about
 * them would be permanently absent rather than occasionally empty. `projectCount`
 * is console telling us this repository was curated into a project *before* -
 * which is the one thing a register-only caller cannot tell from the response,
 * and the reason the field exists.
 */
export type ConsoleRepoRegistration = {
  ok: boolean
  repo?: { id: string; full_name: string; stars: number }
  created?: boolean
  projectCount?: number
}

/**
 * A submission plus which endpoint produced it.
 *
 * `mode` is on the result rather than left to the caller to re-read the flag
 * for: the mode decides whether a skill document is ever going to arrive, and a
 * caller that guessed wrong here waits out a full poll timeout for a push that
 * console is not going to make.
 */
export type ConsoleSubmitResult =
  | ({ mode: "publish" } & ConsoleIngestResult)
  | ({ mode: "register" } & ConsoleRepoRegistration)

/**
 * One skill as `GET /api/skills-sync/export` serves it: an event envelope whose
 * `data` is the same body the webhook POSTs, so both channels carry identical
 * bytes. Typing the page as the inner data instead let the caller unwrap it
 * wrong and silently ingest `undefined` for every field.
 */
export type ConsoleSkillEnvelope = {
  event_type: string
  timestamp: string
  data: SkillWebhookData
}

export type ConsoleSkillsPage = {
  skills: ConsoleSkillEnvelope[]
  next_cursor: string | null
}

export type ConsoleSyncResult = {
  now?: string
  recovered?: number
  registered?: string[]
  results?: Record<string, string>
  periods?: Record<string, string>
}

export function consoleBaseUrl(): string {
  const raw = (process.env.CONSOLE_API_BASE_URL || "").trim()
  return raw.replace(/\/$/, "")
}

/**
 * Bearer for `POST /api/v1/projects`.
 *
 * Issued on console and scoped `projects:write`; see the file header for why
 * this app needs publishing rights and no more. The old `CONSOLE_API_TOKEN` /
 * `GITHUB_NEXTJS_API_TOKEN` pair is deliberately not accepted as a fallback:
 * those credentials belonged to the deleted endpoint, and silently keeping them
 * working would leave the old blast radius in place.
 */
export function consoleApiToken(): string | undefined {
  return process.env.CONSOLE_API_KEY?.trim() || undefined
}

/**
 * Bearer for `GET /api/skills-sync/export` and `POST /api/cron/github`.
 *
 * console reads the same variable name for both (`SKILLS_WEBHOOK_TOKEN`,
 * `CRON_SECRET`), so they are resolved separately here rather than collapsed
 * into one "console token" - a deployment can legitimately allow the skill
 * pull without letting this app drive the scheduler.
 */
export function consoleSkillsToken(): string | undefined {
  return process.env.SKILLS_WEBHOOK_TOKEN?.trim() || undefined
}

export function consoleCronSecret(): string | undefined {
  return process.env.CRON_SECRET?.trim() || undefined
}

/**
 * Where console should deliver the skill documents of a repository we submit.
 *
 * Console has no deployment-wide skills endpoint any more. The submitter names
 * the address on `POST /api/v1/projects` as `callbackUrl`, together with
 * `callbackSecret`, and console records the pair against the project it created
 * so its retry queue — which runs with no request to read an address from — can
 * still reach us later.
 *
 * Defaults to this app's own base URL, which is right in the common case and
 * keeps one origin defined in one place. But it is overridable: a wrong address
 * here fails quietly. Console would accept the submission, store the documents
 * and push them into nothing, and the only symptom is a skill sitting in its
 * retry queue — recoverable solely by this app's own pull channel. That is a
 * bad failure mode for a value whose whole job is to be reachable, so a
 * deployment that sits behind a proxy, a custom domain or a tunnel should set
 * `CONSOLE_SKILLS_CALLBACK_URL` explicitly rather than trust the derivation.
 */
export function consoleSkillsCallbackUrl(): string {
  const override = process.env.CONSOLE_SKILLS_CALLBACK_URL?.trim()
  if (override) return override.replace(/\/$/, "")
  return `${getBaseUrl().replace(/\/$/, "")}/api/webhook/daily/skills`
}

/**
 * The HMAC key console signs each skill delivery with.
 *
 * Separate from `SKILLS_WEBHOOK_TOKEN`, which authorises the *pull* direction.
 * Keeping them apart is what makes the per-submitter model meaningful: the
 * export token reads every project's skills and can push to none of them,
 * while this key authorises console to push only to this app.
 *
 * Unset means no signature can be produced, so a submission goes out without a
 * destination and console stores the skills for later rather than delivering
 * unsigned ones the receiver has to accept on address alone.
 */
export function consoleSkillsCallbackSecret(): string | undefined {
  return process.env.CONSOLE_SKILLS_CALLBACK_SECRET?.trim() || undefined
}

/**
 * Whether a repository submission registers it without publishing anything.
 *
 * Set `CONSOLE_SKILLS_REGISTER_ONLY=true` and submissions go to console's
 * `POST /api/v1/repos` instead of `POST /api/v1/projects`: console records the
 * repository and links it to this app's submitter account, and stops there. No
 * project row, so nothing is listed publicly, and no skill-document sync, so
 * nothing is pushed back into this app either.
 *
 * **Defaults to publishing**, because that is what every deployment did before
 * this flag existed and flipping it silently would stop publishing skills that
 * are currently live. An operator turns it on deliberately.
 *
 * The submitter account is the key's `submitter_id` on console, not the end user
 * who pasted the URL: one service key carries many users' submissions, so
 * `user_repos` rows all land on the single account the operator minted the key
 * for. `user_repos` is the right place for that - `repos.created_by` cannot be
 * reused for it, since it answers "who first submitted this" and must not
 * change when a second user submits the same URL.
 *
 * Accepted as true: anything that is not empty, `0`, `false`, `no` or `off`.
 * Same vocabulary as `local-cron`'s `envBool`, so one deployment does not end up
 * with two spellings of "off".
 */
export function consoleSkillsRegisterOnly(): boolean {
  const raw = process.env.CONSOLE_SKILLS_REGISTER_ONLY?.trim().toLowerCase()
  if (raw === undefined || raw === "") return false
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off"
}

/** The endpoint a submission will use. See {@link ConsoleSubmitMode}. */
export function consoleSubmitMode(): ConsoleSubmitMode {
  return consoleSkillsRegisterOnly() ? "register" : "publish"
}

/**
 * True when a repository submission can be made at all.
 *
 * Covers both endpoints, so it does not check the scope: which one is used is
 * {@link consoleSubmitMode}'s business, and a deployment that switched modes
 * without re-minting the key finds out as a 403 from console rather than as this
 * returning false and the app silently pretending console is absent.
 *
 * The callback pair is not part of this: a publish without it still publishes,
 * it just leaves console holding the documents instead of pushing them here.
 * {@link submitRepo} reports that back through `delivered: null` rather than
 * failing the call. In register mode the pair is not sent at all - see
 * {@link registerRepoWithConsole}.
 */
export function consoleApiConfigured(): boolean {
  return Boolean(consoleBaseUrl() && consoleApiToken())
}

/** True when `GET /api/skills-sync/export` can be called at all. */
export function consoleSkillsExportConfigured(): boolean {
  return Boolean(consoleBaseUrl() && consoleSkillsToken())
}

/**
 * A console response, keeping the status so callers can tell "console is not
 * configured" (404) apart from "console rejected this" (400/401).
 */
export class ConsoleApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ConsoleApiError"
    this.status = status
  }

  /** console hides an unconfigured route behind a 404. */
  get notConfigured(): boolean {
    return this.status === 404
  }
}

/**
 * Thrown when *this client's* budget ended the call, as opposed to console
 * answering with a status.
 *
 * The two answer different questions, and conflating them is what turned a slow
 * repository into a reported failure. A status means console received the
 * request and refused it: a bad key, an insufficient scope, an unparseable URL —
 * re-sending it changes nothing. This client's budget expiring means console was
 * most likely still working, because it fetches, translates and pushes before it
 * answers, which for a repository holding more than a handful of skills takes
 * longer than this call waits. console finishes that work on its own and
 * delivers the skills either way.
 *
 * So callers get this one separately in order to keep waiting instead of
 * telling the user their submission failed.
 */
export class ConsoleTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`console 响应超时（${Math.round(timeoutMs / 1000)}s）`)
    this.name = "ConsoleTimeoutError"
  }
}

/** True for the abort a `AbortSignal.timeout` raises, in either DOMException shape. */
function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === "TimeoutError" || error.name === "AbortError") return true
  const cause = (error as { cause?: unknown }).cause
  return (
    cause instanceof Error &&
    (cause.name === "TimeoutError" || cause.name === "AbortError")
  )
}

async function request(
  path: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  try {
    return await fetch(`${consoleBaseUrl()}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
  } catch (error) {
    if (isTimeout(error)) throw new ConsoleTimeoutError(timeoutMs)
    throw error
  }
}

/**
 * Pull a human-readable reason out of a console error.
 *
 * Two shapes have to be read: `/api/v1` answers `{ error: { code, message } }`,
 * while the two endpoints it shares this file with still answer a flat
 * `{ error: "..." }`. Whichever arrives, the message wins over the status text -
 * `insufficient_scope` explains a 403 in a way `console returned 403` never will.
 */
async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "")
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === "string") return parsed.error
    if (parsed.error && typeof parsed.error === "object") {
      const { message, detail } = parsed.error as {
        message?: unknown
        detail?: unknown
      }
      if (typeof message === "string") {
        return typeof detail === "string" ? `${message} (${detail})` : message
      }
    }
  } catch {
    // Not JSON - fall through to the raw body.
  }
  return body.slice(0, 200) || `console returned ${res.status}`
}

/**
 * True when console answered a publish but reports holding no skill document for
 * it — that is, when nothing is ever going to arrive here and re-submitting will
 * not change it.
 *
 * `delivered` cannot answer this. It is `pushed === found`, so a repository whose
 * configured skill path holds nothing reports `found: 0, delivered: true`: read as
 * "the skills are on their way" that sends the caller off to spend a whole polling
 * budget waiting for a push that was never going to happen. The two fields that do
 * answer it are the sync result's `empty` (console read the path and found no
 * document) and the delivery's `found` (console had no stored row to push).
 *
 * Unset fields answer nothing and so answer no. `delivery: null` means console had
 * no destination at all, and a sync result that is absent (a repository curated
 * before this submission) says nothing about what the path holds.
 */
export function consoleFoundNoSkills(result: ConsoleIngestResult): boolean {
  if (result.skills?.empty === true) return true
  const found = result.delivery?.found
  return found === 0
}

/**
 * Register a repository with console without publishing it.
 *
 * `POST /api/v1/repos` writes `repos` and, when the key carries a
 * `submitter_id`, a `user_repos` row naming this app's platform account. It
 * creates no project, so the repository is not listed on the public site, and it
 * runs no skill-document sync, so no skill is ever pushed back here. console's
 * own scheduler picks the repository up for stats and ranking, which is the
 * point: tracked upstream, private downstream.
 *
 * Three things this request deliberately does not carry:
 *
 * - **`type`.** console rejects the field outright on this endpoint, because
 *   accepting a classification on a registration is how "registering also
 *   publishes" creeps back in as a default. Sending it would turn every
 *   register-only submission into a 400 that points at the publish endpoint.
 * - **`callbackUrl` / `callbackSecret`.** There are no skill documents to
 *   deliver, so the only thing the pair would buy is a one-shot `repo.registered`
 *   POST aimed at a route built to accept skill documents - it would fail to
 *   ingest and log a warning on console's side on every single submission.
 * - **A skill classification.** Ignored even if a caller passes one.
 *
 * Throws {@link ConsoleApiError} like {@link publishProjectByUrl}.
 */
export async function registerRepoWithConsole(
  repoUrl: string
): Promise<ConsoleRepoRegistration> {
  const token = consoleApiToken()
  if (!consoleBaseUrl() || !token) {
    throw new ConsoleApiError("console 未配置，无法登记仓库", 404)
  }

  // console still fetches the repository from GitHub here, so this is not a
  // cheaper call than publishing - it is the same work minus the parts that
  // create a project.
  const res = await request(
    "/api/v1/repos",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: repoUrl }),
    },
    INGEST_TIMEOUT_MS
  )

  if (!res.ok) {
    throw new ConsoleApiError(await readError(res), res.status)
  }

  return (await res.json()) as ConsoleRepoRegistration
}

/**
 * Publish a repository as a console project and pull its skill documents back.
 *
 * console holds the GitHub credentials and owns the repository, project and
 * skill-document tables, so a bare URL is all this app has to send. console
 * does the whole curation inline — fetch, create the project, sync the skill
 * documents, then push them back through the webhook this app ingests — and
 * its `delivered` flag says whether the skill reached us before it answered.
 *
 * The callback pair travels with the request: it is how console learns where to
 * deliver those documents at all. Without it console still creates the project,
 * but the skills stay queued on its side and `delivered` comes back `null`,
 * which is a deployment fact rather than a failed delivery.
 *
 * Requires a key scoped `projects:write`. Publishing is admin-granted and
 * deliberately not self-service, because it is what puts a repository on the
 * public site.
 *
 * Throws {@link ConsoleApiError}; callers on a user-facing path should catch,
 * because a console outage must not fail a creator's submission.
 */
export async function publishProjectByUrl(
  repoUrl: string,
  type: ConsoleProjectType = "skill"
): Promise<ConsoleIngestResult> {
  const token = consoleApiToken()
  if (!consoleBaseUrl() || !token) {
    throw new ConsoleApiError("console 未配置，无法登记仓库", 404)
  }

  // Both or neither: console rejects a `callbackUrl` with no secret rather than
  // picking a default, because a derived default is either a constant, which
  // authenticates nothing, or derived from the API key, which ties the key's
  // lifetime to the callback.
  const callbackSecret = consoleSkillsCallbackSecret()
  const body: Record<string, unknown> = { url: repoUrl, type }
  if (callbackSecret) {
    body.callbackUrl = consoleSkillsCallbackUrl()
    body.callbackSecret = callbackSecret
  }

  const res = await request(
    "/api/v1/projects",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    INGEST_TIMEOUT_MS
  )

  if (!res.ok) {
    throw new ConsoleApiError(await readError(res), res.status)
  }

  return (await res.json()) as ConsoleIngestResult
}

/**
 * Submit a repository to console, publishing or merely registering per
 * {@link consoleSubmitMode}.
 *
 * The one call both submission paths make, so the mode is decided in one place:
 * `registerWithConsole` (which reports readiness back to the submit dialog) and
 * the fire-and-forget registration after a listing is written would otherwise
 * each pick an endpoint, and a deployment would end up publishing from one path
 * and only registering from the other.
 */
export async function submitRepo(
  repoUrl: string,
  type: ConsoleProjectType = "skill"
): Promise<ConsoleSubmitResult> {
  if (consoleSubmitMode() === "register") {
    return { mode: "register", ...(await registerRepoWithConsole(repoUrl)) }
  }
  return { mode: "publish", ...(await publishProjectByUrl(repoUrl, type)) }
}

/**
 * One page of console's synced skill documents.
 *
 * Same payload the console push webhook sends, so a skill can arrive either way
 * without being translated. `cursor` is the moment a skill was last confirmed
 * synced; omitting it starts the walk at whatever is still outstanding.
 */
export async function fetchConsoleSkills(
  options: { limit?: number; cursor?: string | null } = {}
): Promise<ConsoleSkillsPage> {
  const token = consoleSkillsToken()
  if (!consoleBaseUrl() || !token) {
    throw new ConsoleApiError("console 未配置，无法拉取技能", 404)
  }

  const params = new URLSearchParams()
  if (options.limit != null) params.set("limit", String(options.limit))
  if (options.cursor) params.set("cursor", options.cursor)

  const query = params.toString()
  const res = await request(
    `/api/skills-sync/export${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  if (!res.ok) {
    throw new ConsoleApiError(await readError(res), res.status)
  }

  return (await res.json()) as ConsoleSkillsPage
}

/**
 * Ask console to run its scheduler now.
 *
 * This is console's whole task graph, not a single job, so it is a cron-grade
 * operation and not something to call from a user's click: it will return 409
 * for any task whose period has already run. Prefer letting console's own
 * Vercel Cron drive `GET /api/cron/github`.
 */
export async function triggerConsoleSync(): Promise<ConsoleSyncResult> {
  const secret = consoleCronSecret()
  if (!consoleBaseUrl() || !secret) {
    throw new ConsoleApiError("console 定时任务未配置，无法手动触发", 404)
  }

  const res = await request("/api/cron/github", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  })

  if (!res.ok) {
    throw new ConsoleApiError(await readError(res), res.status)
  }

  return (await res.json()) as ConsoleSyncResult
}

/**
 * Where console executed a skill scan.
 *
 * `vercel-sandbox-serverless` is the fallback console takes when an in-sandbox
 * script fails: the files come back and the rules run in the function. Only
 * that one failure mode falls back; a repository that cannot be fetched stays
 * an error rather than silently downgrading to a different source.
 */
export type ConsoleScanSource = "local-clone" | "vercel-sandbox" | "vercel-sandbox-serverless"

/**
 * console's answer to `POST /api/v1/skills/scan`.
 *
 * The shapes of `flags` / `context` / `llmAnalysis` are owned by
 * `@workspace/security-scan`'s `types.ts`; console's contract points back to it
 * rather than re-declaring them, and so does this client. The response also
 * carries the actual files scanned, but the caller does not need them — it only
 * persists the conclusion.
 */
export type ConsoleScanResponse = {
  repoFullName: string
  skillDir?: string
  ref?: string
  source: ConsoleScanSource
  grade: SecurityGrade
  flags: SecurityFlagHit[]
  trustTier: TrustTier
  llmGrade?: SecurityGrade
  llmAnalysis?: LlmAnalysis
  scannedAt: string
  rulesVersion: string
  fileCount: number
  truncated: boolean
  truncatedReason?: string
  files: Array<{ path: string; size: number }>
}

/**
 * Run the security scanner on a repository, on console.
 *
 * The request carries **an address, not files**: console fetches the source
 * itself, so the same commit gets the same conclusion no matter who asks.
 * `CONSOLE_API_KEY` is the credential, same as `submitRepo` — console answers
 * 403 `insufficient_scope` when the key does not carry `skills:scan`.
 *
 * The call may be long: console clones a repository before it answers. This is
 * still a bound, matching `INGEST_TIMEOUT_MS`, and an unparseable repository
 * fails rather than pinning the caller's request open.
 */
export async function scanSkillOnConsole(input: {
  repoFullName: string
  ref?: string
  skillDir?: string
  includeLlm?: boolean
}): Promise<ConsoleScanResponse> {
  const token = consoleApiToken()
  if (!consoleBaseUrl() || !token) {
    throw new ConsoleApiError("console 未配置，无法执行远程扫描", 404)
  }

  const res = await request(
    "/api/v1/skills/scan",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    },
    INGEST_TIMEOUT_MS
  )

  if (!res.ok) {
    throw new ConsoleApiError(await readError(res), res.status)
  }

  return (await res.json()) as ConsoleScanResponse
}
