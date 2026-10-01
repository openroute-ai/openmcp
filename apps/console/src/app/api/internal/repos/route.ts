/**
 * The machine-to-machine repository ingest endpoint.
 *
 * It accepts two body shapes:
 *
 * 1. a `RepoInfo`, exactly as `fetchRepoInfo` builds one. An external
 *    collector that already holds GitHub data pushes it here instead of making
 *    this app re-query the API. `upsertRepo` applies the same rules it applies
 *    to its own refreshes: a new row for an unknown repository, and a partial
 *    update for a known one that leaves the fields other tasks own — the
 *    README, its translation, the icon and the OSS image URLs — untouched.
 *
 * 2. `{ url, type? }`. A caller that does *not* hold GitHub data — the skills
 *    web app, on behalf of a creator who pasted a repository — asks this app to
 *    do the whole curation inline: fetch the repository, create the project,
 *    sync its skills, and push them to the web service before responding. The
 *    caller is waiting on a user, so the work cannot be left to the next
 *    scheduled sweep.
 *
 * Fails closed like the Cron and webhook routes: with no `CONSOLE_API_TOKEN`
 * the route reports 404 rather than 401, so an unconfigured instance does not
 * confirm that an unauthenticated write endpoint exists.
 */

import { db } from "@/db/client"
import type { ProjectType } from "@/db/schema"
import { apiToken, requireGitHubToken, syncEnv } from "@/lib/env"
import { authorized } from "@/lib/cron/guard"
import { createGitHubClient } from "@/lib/github/client"
import { parseRepoIngest } from "@/lib/github/repo-info-payload"
import { parseGithubRepoUrl } from "@/lib/github/repo-url"
import { pushSkill } from "@/lib/github/service/push-skill"
import { getRepoByFullName, upsertRepo } from "@/lib/github/service/repo"
import { getProjectByFullName } from "@/lib/github/service/project"
import { listSkillsForProject } from "@/lib/github/service/skill"
import {
  createProjectFromRepo,
  InvalidRepoUrlError,
} from "@/lib/github/service/create-project"
import { syncSkillsForProject } from "@/lib/github/sync-skills"
import { createBufferingLogger } from "@/lib/tasks/runner"
import { NextResponse } from "next/server"

/** Writes on every call, so nothing here may be served from a cache. */
export const dynamic = "force-dynamic"

/**
 * A URL-form request fetches from GitHub, translates, and delivers a webhook,
 * so it can outlive the default 10s function budget on a large repository.
 */
export const maxDuration = 300

export async function POST(request: Request) {
  const token = apiToken()

  if (!token) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  if (!authorized(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "body is not valid JSON" },
      { status: 400 }
    )
  }

  const parsed = parseRepoIngest(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 400 })
  }

  if (parsed.ingest.kind === "info") {
    const repo = await upsertRepo(db, parsed.ingest.info)

    return NextResponse.json({
      ok: true,
      // Stored as two columns, so the full name is reassembled here rather than
      // read from a column that does not exist.
      repo: {
        id: repo.id,
        full_name: `${repo.owner}/${repo.name}`,
        stars: repo.stars,
      },
    })
  }

  return ingestFromUrl(parsed.ingest.url, parsed.ingest.type)
}

/**
 * Fetches, curates and delivers a repository named only by URL.
 *
 * The heavy lifting is `createProjectFromRepo`, the same call the console's
 * create dialog makes, so a repository registered from the web app is
 * indistinguishable from one an operator curated by hand. What this adds is
 * the delivery step: the web app is waiting for the skill to exist before it
 * can show it, and the scheduled `push-skills` sweep would make it wait.
 */
async function ingestFromUrl(url: string, type: ProjectType) {
  const ref = parseGithubRepoUrl(url)
  if (!ref) {
    return NextResponse.json(
      { error: `"${url}" is not a GitHub repository URL` },
      { status: 400 }
    )
  }

  // Unlike a `RepoInfo` push, this path reaches GitHub itself. A missing token
  // is an operator misconfiguration, not a bad request.
  try {
    requireGitHubToken()
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "GitHub token missing" },
      { status: 503 }
    )
  }

  const logger = createBufferingLogger()

  let created
  try {
    created = await createProjectFromRepo(db, { url, type }, { logger })
  } catch (error) {
    if (error instanceof InvalidRepoUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error(`ingest failed for ${ref.fullName}`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ingest failed" },
      { status: 502 }
    )
  }

  // `createProjectFromRepo` returns early for a repository that already has a
  // project, so it does not re-sync. A caller that asked for the skill *now*
  // must not be told "existing" and then wait for the scheduler, so the sync is
  // repeated here — idempotent, and the only case where it runs twice.
  let skills: { count: number; translated: number; empty: boolean } | null =
    created.skills
  if (type === "skill" && created.status === "existing") {
    const project = await getProjectByFullName(db, ref.fullName)
    const repo = await getRepoByFullName(db, ref.fullName)
    if (project && repo) {
      const synced = await syncSkillsForProject(
        db,
        createGitHubClient(),
        { project, repo },
        { logger }
      )
      skills = {
        count: synced.skills,
        translated: synced.translated,
        empty: synced.empty,
      }
    }
  }

  const delivery = await deliverSkills(created.project.id, logger)

  return NextResponse.json({
    ok: true,
    status: created.status,
    repo: { full_name: ref.fullName },
    project: created.project,
    skills: delivery ? { ...skills, ...delivery } : skills,
    // The single flag a caller needs: every stored skill reached the web
    // service, so the skill it asked for is now available there.
    delivered: delivery?.failed === 0,
  })
}

/**
 * Pushes every stored skill of a project to the web service.
 *
 * Returns `null` when no webhook is configured: the skills are stored and the
 * scheduled task will deliver them, but this request cannot claim they arrived.
 * A rejected delivery is recorded on the row by `pushSkill`, so the task's
 * retry queue picks it up rather than losing it here.
 */
async function deliverSkills(projectId: string, logger: ReturnType<typeof createBufferingLogger>) {
  const env = syncEnv()
  const webhookUrl = env.SKILLS_WEBHOOK_URL
  if (!webhookUrl) {
    logger.warn("SKILLS_WEBHOOK_URL is not set; skills stored for retry")
    return null
  }

  const stored = await listSkillsForProject(db, projectId)
  if (stored.length === 0) {
    return { found: 0, pushed: 0, failed: 0, results: [] }
  }

  const results = []
  let pushed = 0
  for (const skill of stored) {
    const result = await pushSkill(
      db,
      { projectId, skillDir: skill.skillDir },
      {
        webhookUrl,
        secret: env.GITHUB_DATA_WEBHOOK_SECRET,
        token: env.SKILLS_WEBHOOK_TOKEN,
      }
    )
    if (result.pushed) pushed += 1
    else logger.error(`failed to push ${result.fullName} (${result.skillDir}): ${result.summary}`)
    results.push({
      skillDir: result.skillDir,
      pushed: result.pushed,
      summary: result.summary,
    })
  }

  return { found: stored.length, pushed, failed: stored.length - pushed, results }
}
