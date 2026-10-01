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
 *   POST /api/internal/repos        register a repository we already hold
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

/** How long a machine-to-machine call may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * The subset of the local `repos` row that console needs.
 *
 * Structural rather than a drizzle inference so the client can be called with
 * a projection instead of a full row: the README columns are the bulk of the
 * table and console does not accept them.
 */
export type ConsoleRepoSource = {
  owner: string
  name: string
  ownerId?: number | null
  description?: string | null
  homepage?: string | null
  createdAt?: Date | string | null
  pushedAt?: Date | string | null
  defaultBranch?: string | null
  stars?: number | null
  /**
   * jsonb, so typed as unknown rather than as the array it is expected to hold.
   * The mapping filters to strings, which keeps a malformed row from reaching
   * console's strict schema as something other than a 400.
   */
  topics?: unknown
  archived?: boolean | null
  commitCount?: number | null
  lastCommit?: Date | string | null
  mentionableUsersCount?: number | null
  watchersCount?: number | null
  licenseSpdxId?: string | null
  pullRequestsCount?: number | null
  releasesCount?: number | null
  /**
   * console tracks it, this app does not: the local `repos` table has no such
   * column, so it is absent from every row this app can supply and goes over
   * as 0. console's own stats task fills it in.
   */
  openIssuesCount?: number | null
  languages?: unknown
  forks?: number | null
  openGraphImageUrl?: string | null
  usesCustomOpenGraphImage?: boolean | null
  latestReleaseName?: string | null
  latestReleaseTagName?: string | null
  latestReleasePublishedAt?: Date | string | null
  latestReleaseUrl?: string | null
  latestReleaseDescription?: string | null
}

/**
 * console's `RepoInfo`, in the wire form its ingest schema parses.
 *
 * The schema is `strict()`, so a field that is not in this list is a 400 and
 * nothing more: adding one to the object literal is a deliberate act, and
 * `RepoInfo` gaining a field without it gaining one here shows up as a
 * validation error rather than as a silently dropped column.
 */
export type ConsoleRepoInfo = {
  name: string
  fullName: string
  owner: string
  ownerId: number
  description: string
  homepage: string
  createdAt: string
  pushedAt: string
  defaultBranch: string
  stars: number
  topics: string[]
  archived: boolean
  commitCount: number
  lastCommit: string
  mentionableUsersCount: number
  watchersCount: number
  licenseSpdxId: string
  pullRequestsCount: number
  openIssuesCount: number
  releasesCount: number
  languages: string[]
  forks: number
  openGraphImageUrl: string
  usesCustomOpenGraphImage: boolean
  latestReleaseName: string
  latestReleaseTagName: string
  latestReleasePublishedAt?: string | null
  latestReleaseUrl: string
  latestReleaseDescription: string
}

export type ConsoleIngestResult = {
  ok: boolean
  repo?: { id: string; full_name: string; stars: number | null }
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

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isoDate(value: Date | string | null | undefined, fallback: Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return fallback.toISOString()
}

/**
 * Map a local `repos` row onto console's `RepoInfo`.
 *
 * Two defaults are load-bearing rather than cosmetic. `lastCommit` falls back
 * to `pushedAt` because console's schema requires it while the local column is
 * nullable, and sending the epoch would render as "committed in 1970" on the
 * other side. `ownerId` falls back to 0 because it is a required integer:
 * console only uses it to build an avatar URL, so a wrong value is visibly
 * wrong and recoverable, whereas omitting it is a 400 that drops the whole
 * repository. The same reasoning applies to the counters this app never
 * measured: they go over as 0, and console's own tasks correct them.
 */
export function toConsoleRepoInfo(repo: ConsoleRepoSource, now = new Date()): ConsoleRepoInfo {
  const pushedAt = isoDate(repo.pushedAt, now)
  return {
    name: repo.name,
    fullName: `${repo.owner}/${repo.name}`,
    owner: repo.owner,
    ownerId: typeof repo.ownerId === 'number' && Number.isFinite(repo.ownerId) ? Math.floor(repo.ownerId) : 0,
    description: text(repo.description),
    homepage: text(repo.homepage),
    createdAt: isoDate(repo.createdAt, now),
    pushedAt,
    defaultBranch: text(repo.defaultBranch),
    stars: count(repo.stars),
    topics: list(repo.topics),
    archived: repo.archived === true,
    commitCount: count(repo.commitCount),
    lastCommit: isoDate(repo.lastCommit, new Date(pushedAt)),
    mentionableUsersCount: count(repo.mentionableUsersCount),
    watchersCount: count(repo.watchersCount),
    licenseSpdxId: text(repo.licenseSpdxId),
    pullRequestsCount: count(repo.pullRequestsCount),
    openIssuesCount: count(repo.openIssuesCount),
    releasesCount: count(repo.releasesCount),
    languages: list(repo.languages),
    forks: count(repo.forks),
    openGraphImageUrl: text(repo.openGraphImageUrl),
    usesCustomOpenGraphImage: repo.usesCustomOpenGraphImage === true,
    latestReleaseName: text(repo.latestReleaseName),
    latestReleaseTagName: text(repo.latestReleaseTagName),
    latestReleasePublishedAt: repo.latestReleasePublishedAt ? isoDate(repo.latestReleasePublishedAt, now) : null,
    latestReleaseUrl: text(repo.latestReleaseUrl),
    latestReleaseDescription: text(repo.latestReleaseDescription),
  }
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

async function request(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${consoleBaseUrl()}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
 * Hand console a repository we already hold GitHub data for.
 *
 * console's ingest is upsert-only and leaves the columns its own tasks own
 * (README, translations, mirrored icons) alone, so pushing a partial view is
 * safe and pushing often is idempotent. It does not fetch from GitHub: it is
 * the ingest path for a collector that already queried the API, which is what
 * this app is for the repositories its crawler has seen.
 *
 * Throws {@link ConsoleApiError}; callers on a user-facing path should catch,
 * because a console outage must not fail a creator's submission.
 */
export async function ingestRepo(repo: ConsoleRepoSource): Promise<ConsoleIngestResult> {
  const token = consoleApiToken()
  if (!consoleBaseUrl() || !token) {
    throw new ConsoleApiError('console 未配置，无法登记仓库', 404)
  }

  const res = await request('/api/internal/repos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(toConsoleRepoInfo(repo)),
  })

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