/**
 * Client for `apps/console`, the GitHub data / sync domain this app shares
 * with it.
 *
 * console owns the repository, project, ranking and skill-document tables and
 * the tasks that keep them current. This app owns the marketplace: listings,
 * authors, purchases, wallets. The two agree on three endpoints, all of which
 * authenticate with a static bearer rather than a user session, because all of
 * them are machine-to-machine:
 *
 *   POST /api/internal/repos        register a repository by URL
 *   GET  /api/skills-sync/export    page through synced skill documents
 *   POST /api/cron/github           run the console scheduler on demand
 *
 * Every one of them fails closed on console's side: with no token configured
 * the route reports 404 rather than 401. That is why nothing here treats a 404
 * as an error worth surfacing to a user - an unconfigured console is a normal
 * single-app deployment, and `consoleApiConfigured()` is the call sites' way
 * to ask before they try.
 *
 * `GITHUB_NEXTJS_API_*` is the name console had before it was renamed, and it
 * is still accepted so an existing deployment keeps working. Prefer the
 * `CONSOLE_API_*` pair.
 */

import type { SkillWebhookData } from '@/lib/skills/ingest-console-skill'

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
export type ConsoleProjectType = 'application' | 'skill' | 'client' | 'server' | 'persona'

export type ConsoleIngestResult = {
  ok: boolean
  /** `existing` when the repository already had a project on console. */
  status?: 'created' | 'existing'
  repo?: { full_name: string }
  project?: {
    id: string
    name: string
    slug: string
    type: string
    status: string
    description: string
  }
  skills?: {
    count?: number
    translated?: number
    empty?: boolean
    found?: number
    pushed?: number
    failed?: number
    results?: Array<{ skillDir: string; pushed: boolean; summary: string }>
  } | null
  /** Every stored skill reached this app's webhook. */
  delivered?: boolean
  message?: string
}

export type ConsoleSkillsPage = {
  skills: SkillWebhookData[]
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
  const raw = (
    process.env.CONSOLE_API_BASE_URL ||
    // console was `github-nextjs` before it was renamed; keep old deployments working.
    process.env.GITHUB_NEXTJS_API_BASE_URL ||
    ''
  ).trim()
  return raw.replace(/\/$/, '')
}

/** Bearer for `POST /api/internal/repos` (console reads `CONSOLE_API_TOKEN`). */
export function consoleApiToken(): string | undefined {
  return (
    process.env.CONSOLE_API_TOKEN?.trim() ||
    process.env.GITHUB_NEXTJS_API_TOKEN?.trim() ||
    undefined
  )
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

/** True when `POST /api/internal/repos` can be called at all. */
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
    this.name = 'ConsoleApiError'
    this.status = status
  }

  /** console hides an unconfigured route behind a 404. */
  get notConfigured(): boolean {
    return this.status === 404
  }
}

async function request(path: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  return fetch(`${consoleBaseUrl()}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    // Not JSON - fall through to the raw body.
  }
  return body.slice(0, 200) || `console returned ${res.status}`
}

/**
 * Ask console to take over a repository, naming it by URL.
 *
 * console holds the GitHub credentials and owns the repository, project and
 * skill-document tables, so a bare URL is all this app has to send. console
 * does the whole curation inline — fetch, create the project, sync the skill
 * documents, then push them back through the webhook this app ingests — and
 * its `delivered` flag says whether the skill reached us before it answered.
 *
 * This replaces the older "push the `RepoInfo` we happen to hold" ingest: this
 * app never writes its own `repos` table outside the crawler, so most
 * repositories a creator names have no local row to push, and the ones that do
 * would only be re-sending data console is about to fetch anyway.
 *
 * Throws {@link ConsoleApiError}; callers on a user-facing path should catch,
 * because a console outage must not fail a creator's submission.
 */
export async function ingestRepoByUrl(
  repoUrl: string,
  type: ConsoleProjectType = 'skill'
): Promise<ConsoleIngestResult> {
  const token = consoleApiToken()
  if (!consoleBaseUrl() || !token) {
    throw new ConsoleApiError('console 未配置，无法登记仓库', 404)
  }

  const res = await request(
    '/api/internal/repos',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: repoUrl, type }),
    },
    INGEST_TIMEOUT_MS
  )

  if (!res.ok) {
    throw new ConsoleApiError(await readError(res), res.status)
  }

  return (await res.json()) as ConsoleIngestResult
}

/**
 * One page of console's synced skill documents.
 *
 * Same payload the console push webhook sends, so a skill can arrive either way
 * without being translated. `cursor` is the moment a skill was last confirmed
 * synced; omitting it starts the walk at whatever is still outstanding.
 */
export async function fetchConsoleSkills(options: { limit?: number; cursor?: string | null } = {}): Promise<ConsoleSkillsPage> {
  const token = consoleSkillsToken()
  if (!consoleBaseUrl() || !token) {
    throw new ConsoleApiError('console 未配置，无法拉取技能', 404)
  }

  const params = new URLSearchParams()
  if (options.limit != null) params.set('limit', String(options.limit))
  if (options.cursor) params.set('cursor', options.cursor)

  const query = params.toString()
  const res = await request(`/api/skills-sync/export${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })

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
    throw new ConsoleApiError('console 定时任务未配置，无法手动触发', 404)
  }

  const res = await request('/api/cron/github', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })

  if (!res.ok) {
    throw new ConsoleApiError(await readError(res), res.status)
  }

  return (await res.json()) as ConsoleSyncResult
}