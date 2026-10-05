/**
 * `POST /api/v1/projects` — 把一个仓库策展成一个 project，也就是**发布**它。
 *
 * 需要 `projects:write`。这个 scope 是 admin 逐key 授予的（`apiKeys.create`），
 * 默认不在任何自助签发的范围内：发布是运营动作，不是用户对自己数据的操作。
 *
 * 之所以把它从"登记仓库"里拆成独立端点，是因为"登记"与"发布"写的是不同的表，
 * 可见范围差一个数量级：
 *
 * | 端点 | scope | 写 | 公开面可见 |
 * |---|---|---|---|
 * | `POST /api/v1/repos` | `repos:write` | `repos`、`user_repos` | 否 |
 * | `POST /api/v1/projects` | `projects:write` | `projects`（+ README、技能文档） | **是** |
 *
 * 在 `projects` 上建一行就是发布：`lib/public/radar.ts` 的 `PUBLIC_WHERE` 之外的一切
 * 都不读它，而它在之内。所以一把只该"登记仓库"的 key 一旦同时能调这个端点，
 * 它就获得了把任意仓库推上公开站的权限。
 *
 * 幂等：按仓库去重。已经策展过的地址返回既有 project 与
 * `status: "existing"`，不会建第二行。
 *
 * 请求体只有两种地址形态——`{ url }` 或 `{ repo: "owner/repo" }`——与
 * `POST /api/v1/repos` 完全一致，另加可选的 `type` 与那对回调参数。
 *
 * **技能投递**：仅当 `type === "skill"` 时，建完之后同步推一遍下游。
 * 下游地址不是部署级的环境变量，而是这次请求里的 `callbackUrl` / `callbackSecret`：
 * 一个 console 可以同时服务多个提交方，各自的地址与密钥记在各自的 project 行上，
 * 这样重试队列（`push-skills`，全库扫、无请求上下文）也读得到地址。
 * 失败不报错：行已进重试队列，`push-skills` 任务会接手；`delivered` 让调用方
 * 自己决定怎么提示。
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/client"
import { requireGitHubToken } from "@/lib/env"
import {
  apiError,
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import {
  projectCreatedSchema,
  projectRequestSchema,
} from "@/lib/api/contract"
import { resolveWriteTarget } from "@/lib/api/write-request"
import { deliverWriteCallback } from "@/lib/api/callback"
import {
  createProjectFromRepo,
  InvalidRepoUrlError,
} from "@/lib/github/service/create-project"
import { deliverProjectSkills } from "@/lib/github/service/deliver-project-skills"
import { recordSkillsDestination } from "@/lib/github/service/skill-destination"
import { getProjectByFullName } from "@/lib/github/service/project"
import { getRepoByFullName } from "@/lib/github/service/repo"
import { syncSkillsForProject } from "@/lib/github/sync-skills"
import { createBufferingLogger } from "@/lib/tasks/runner"
import { createGitHubClient } from "@/lib/github/client"
import type { ProjectType } from "@/db/schema"

/** Writes on every call, so nothing here may be served from a cache. */
export const dynamic = "force-dynamic"

/**
 * Fetches, translates skills and delivers a webhook before answering, which can
 * outlive the default function budget on a large repository.
 */
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, { scope: "projects:write" })
  if (!auth.ok) return auth.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "body is not valid JSON"),
      auth.rateLimitHeaders
    )
  }

  const parsed = projectRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "需要 { url | repo, type? }", {
        detail: issue
          ? `${issue.path.join(".") || "(body)"}: ${issue.message}`
          : undefined,
      }),
      auth.rateLimitHeaders
    )
  }

  const resolved = resolveWriteTarget(parsed.data)
  if (!resolved.ok) {
    return withRateLimitHeaders(
      apiError(400, resolved.code, resolved.message, {
        detail: resolved.detail,
      }),
      auth.rateLimitHeaders
    )
  }
  const { fullName, callback } = resolved.target

  // The address reaches GitHub itself, so an unconfigured instance must say so
  // rather than fail later inside the fetch.
  try {
    requireGitHubToken()
  } catch (error) {
    return withRateLimitHeaders(
      apiError(
        503,
        "github_unavailable",
        error instanceof Error ? error.message : "GitHub token missing"
      ),
      auth.rateLimitHeaders
    )
  }

  const type: ProjectType = parsed.data.type ?? "application"
  const logger = createBufferingLogger()

  let created
  try {
    created = await createProjectFromRepo(
      db,
      { url: fullName, type },
      { logger }
    )
  } catch (error) {
    if (error instanceof InvalidRepoUrlError) {
      return withRateLimitHeaders(
        apiError(400, "invalid_url", error.message),
        auth.rateLimitHeaders
      )
    }
    logger.error("create project failed", error)
    return withRateLimitHeaders(
      apiError(502, "create_failed", "创建 project 失败"),
      auth.rateLimitHeaders
    )
  }

  // Where this project's skills go comes from the caller's callback pair, and is
  // recorded before delivery so the retry queue and the operator's "retry now"
  // button — both of which run long after this request — have an address to
  // read. Written for every type: a project can be published as one type and
  // later re-submitted as a skill, and the address should not depend on which.
  await recordSkillsDestination(db, created.project.id, resolved.target.callback)

  // `createProjectFromRepo` returns early for an already-curated repository and
  // therefore does not sync its skills. A caller that asked for the skill *now*
  // must not be told "existing" and then wait for the scheduler, so the sync is
  // repeated here — idempotent, and the only case where it runs twice.
  let skills = created.skills
  if (type === "skill" && created.status === "existing") {
    skills = await resyncSkills(fullName)
  }

  // Only a skill project can have skills: `createProjectFromRepo` syncs the
  // documents under `type === "skill"` and nothing else writes them here.
  // Running delivery for any other type would be a pointless query that then
  // answered `delivered: true` about zero skills — a flag the caller cannot act
  // on and would have to learn to ignore.
  const delivery =
    type === "skill"
      ? await deliverProjectSkills(db, created.project.id, { logger })
      : null

  // 回调放在最后：它报的是「项目已经可以被读了」，而那要等 README、技能文档与
  // 投递都跑完——早一步发出去，接收方读到的就是一个还没有技能的项目。
  //
  // `createProjectFromRepo` 返回的 project 是不带 repoId 的子集，而回调的幂等键
  // 需要它，所以这里回读一次仓库行。读不到就不发：宁可少一次回调，也不要发一个
  // `repoId` 为空的 payload 让接收方拿它去查。
  const callbackRepo = callback
    ? await getRepoByFullName(db, fullName)
    : undefined
  if (callback && callbackRepo) {
    const outcome = await deliverWriteCallback(callback, {
      event: "repo.published",
      fullName,
      repoId: callbackRepo.id,
      created: created.status === "created",
      projectId: created.project.id,
    })
    if (!outcome.delivered) {
      console.warn("[api/v1/projects] callback failed", {
        fullName,
        status: outcome.status,
        error: outcome.error,
      })
    }
  }

  return withRateLimitHeaders(
    NextResponse.json(
      {
        ok: true,
        status: created.status,
        // Assembled from the request, not from the project row: `projects`
        // stores owner and name as two columns and has no full-name column.
        repo: { full_name: fullName },
        project: created.project,
        readme: created.readme,
        skills,
        authorLinked: created.authorLinked,
        // The single flag a caller needs: every stored skill reached the web
        // service, so the skill it asked for is now available there. `null`
        // means no downstream is configured, which is not a failure of this
        // call — see `deliverProjectSkills`.
        delivered: delivery ? delivery.delivered : null,
        ...(delivery
          ? {
              delivery: {
                found: delivery.found,
                pushed: delivery.pushed,
                failed: delivery.failed,
              },
            }
          : {}),
      } satisfies z.output<typeof projectCreatedSchema>,
      { status: created.status === "created" ? 201 : 200 }
    ),
    auth.rateLimitHeaders
  )
}

/**
 * Re-runs the skill sync for an already-curated project. Never throws.
 *
 * Returns `null` when the project or its repository cannot be re-read, which is
 * a state the caller cannot act on and is therefore indistinguishable from
 * "nothing to sync" in the response.
 */
async function resyncSkills(fullName: string) {
  const project = await getProjectByFullName(db, fullName)
  const repo = await getRepoByFullName(db, fullName)
  if (!project || !repo) return null

  const logger = createBufferingLogger()
  try {
    const synced = await syncSkillsForProject(
      db,
      createGitHubClient(),
      { project, repo },
      { logger }
    )
    return {
      count: synced.skills,
      translated: synced.translated,
      empty: synced.empty,
    }
  } catch (error) {
    // A failed re-sync is exactly what the original route did: report the empty
    // shape and let the scheduled task retry.
    logger.error("skill resync failed", error)
    return { count: 0, translated: 0, empty: false }
  }
}
