/**
 * `/api/v1/repos` — 登记一个仓库，或列出这把 key 可见的仓库。
 *
 * **`POST` 与 `GET` 在这里不是"同一个资源的两种方法"，而是两件事共用一条路径**：登记
 * 让雷达开始跟踪（`repos` + `user_repos` 两张表），列表读的是"策展成 project、对公开
 * 站可见"的那些仓库。一个刚登记、还没发布的仓库不会出现在 `GET` 的结果里 —— 登记
 * ≠ 对外可见，这是设计文档 §1.4 的分界。
 *
 * `POST` 取代已删除的 `POST /api/internal/repos`。那个端点有三个问题，每一个都是这次
 * 拆分要解决的：用全站共享的 `CONSOLE_API_TOKEN` 鉴权（无 scope、无归属、不可撤销）、
 * 在 URL 分支上调用 `createProjectFromRepo`（于是每个调用方都在替它发布）、
 * 以及把仓库登记和技能投递耦在一个 handler 里。
 *
 * 请求体只有两种形态，都是「给我一个地址」：
 *
 * 1. `{ url }` —— 一整个 GitHub 地址。
 * 2. `{ repo }` —— 裸的 `owner/repo`。
 *
 * 两者都可选地带 `callbackUrl` + `callbackSecret`，落库完成后回调一次。
 *
 * **不接受调用方带来的 GitHub 数据。** 那份星标数、语言、topics 是调用方某一
 * 时刻的快照，让它落库等于让雷达的统计建立在一个可能过期的副本上；服务端自己去
 * 取，多一次请求换来"库里那份和 GitHub 上一致"。两种形态都带 `type` 也一样会被
 * 明确拒绝并指向 `POST /api/v1/projects`：在"登记"端点上接受一个类型字段，等于把
 * "顺手就发布了"重新变成默认值，而那正是这次拆掉的行为。
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
  repoListSchema,
  repoRegisteredSchema,
  repoRegisterRequestSchema,
} from "@/lib/api/contract"
import { parseFilterQuery } from "@/lib/api/filter-query"
import { resolveWriteTarget } from "@/lib/api/write-request"
import { deliverWriteCallback } from "@/lib/api/callback"
import { listRepoItems } from "@/lib/api/repo-payload"
import { createGitHubClient } from "@/lib/github/client"
import {
  getRepoByFullName,
  upsertRepo,
  type RepoRow,
} from "@/lib/github/service/repo"
import { countProjectsForRepo } from "@/lib/github/service/project"
import {
  linkUserToRepo,
  recomputePlatformStates,
} from "@/lib/github/service/user-repo"

/** Both methods touch the database on every call. */
export const dynamic = "force-dynamic"

/** The address reaches GitHub, so it can outlive the default function budget. */
export const maxDuration = 60

/**
 * `GET` — 列出可见仓库。
 *
 * 过滤器与订阅（§6.6）是**同一套语义**、同一份实现（`lib/api/repo-filter.ts`），因为
 * 「列表里看得到」与「推送里收得到」必须是同一个集合：两处各写一份的话，调用方会
 * 遇到按文档建的过滤器在列表里生效、在推送里却收不到数据，而这种不一致要等到第二天
 * 早上才看得出来。
 *
 * 每一行都带分类四轴。过滤器就是拿这四轴判定的，不给调用方看到它们，它就没法自己
 * 验一遍「为什么这个仓库命中了」，只能反过来猜。
 *
 * **没有分页参数**：设计文档 §6.6 只给了过滤器，`limit` / `cursor` 只出现在
 * `GET /api/v1/repos/{id}/stats`。与其在这里发明一套游标，不如让契约如实反映当前的
 * 边界 —— 真要加分页，两处一起改。
 */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, { scope: "repos:read" })
  if (!auth.ok) return auth.response

  const filters = parseFilterQuery(new URL(request.url).searchParams)
  if (!filters.ok) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "查询参数不合法", {
        detail: filters.detail,
      }),
      auth.rateLimitHeaders
    )
  }

  const repos = await listRepoItems(
    db,
    filters.filters,
    // 「自己提交的」认的是 key 的 submitter，不是 key 的归属人：一把 service key
    // 也可能带着某个提交人的身份，而归属人（userId）回答的是另一个问题。
    auth.principal.submitterId
  )

  return withRateLimitHeaders(
    NextResponse.json({ repos } satisfies z.output<typeof repoListSchema>),
    auth.rateLimitHeaders
  )
}

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, { scope: "repos:write" })
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "body is not valid JSON"),
      auth.rateLimitHeaders
    )
  }

  // 先看 `type`：命中就直接指向另一个端点，而不是让 union 的第一个问题
  // ("url 不是字符串") 把调用方引向一个改完仍然会被拒的请求。
  if (hasType(body)) {
    // 答错端点比答错字段更贵：调用方会拿着同一个 body 重试到底。
    return withRateLimitHeaders(
      apiError(
        400,
        "type_not_accepted",
        "这个端点不创建 project；带 type 的请求请用 POST /api/v1/projects",
        {
          detail:
            "登记仓库与发布项目是两个 scope：repos:write 与 projects:write",
        }
      ),
      auth.rateLimitHeaders
    )
  }

  const parsed = repoRegisterRequestSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "需要 { url } 或 { repo: \"owner/name\" }", {
        detail: issue
          ? `${issue.path.join(".") || "(body)"}: ${issue.message}`
          : undefined,
      }),
      auth.rateLimitHeaders
    )
  }

  const resolved = resolveWriteTarget(parsed.data)
  if (!resolved.ok) {
    // 两种 code 都在 400 这一档：`invalid_url` 说地址不对，`invalid_body` 说形状不对。
    return withRateLimitHeaders(
      apiError(400, resolved.code, resolved.message, {
        detail: resolved.detail,
      }),
      auth.rateLimitHeaders
    )
  }
  const { fullName, callback } = resolved.target

  const stored = await store(fullName)
  if ("error" in stored) {
    return withRateLimitHeaders(stored.error, auth.rateLimitHeaders)
  }

  // key 带了 submitterId 才记归属；`repos.created_by` 一律不动 ——
  // 它回答"谁登记了这个仓库"，而 API 调用方不是那个人。
  if (auth.principal.submitterId) {
    await linkUserToRepo(db, {
      userId: auth.principal.submitterId,
      repoId: stored.row.id,
      source: "api",
    })
    await recomputePlatformStates(db, [stored.row.id])
  }

  const projectCount = await countProjectsForRepo(db, stored.row.id)

  // 回调放在最后：它报的是"可以开始读了"，而那要等前面的关联与统计口径都对上。
  // 投递失败只进日志——数据已经在库里了，把写成功报成失败只会招来一次重复登记。
  if (callback) {
    const outcome = await deliverWriteCallback(callback, {
      event: "repo.registered",
      fullName,
      repoId: stored.row.id,
      created: stored.created,
    })
    if (!outcome.delivered) {
      console.warn("[api/v1/repos] callback failed", {
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
        repo: {
          id: stored.row.id,
          full_name: fullName,
          stars: stored.row.stars,
        },
        created: stored.created,
        // 已有多少 project 指向这个仓库。登记端点自己不建 project，所以这个数
        // 只在仓库**先前**被策展过时才是非零——返回它是为了让调用方能区分
        // 「我登记了一个新仓库」和「这个仓库早就发布了，我的 type 被静默忽略
        // 了」，而不用再猜。
        projectCount,
      } satisfies z.output<typeof repoRegisteredSchema>,
      { status: stored.created ? 201 : 200 }
    ),
    auth.rateLimitHeaders
  )
}

function hasType(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { type?: unknown }).type !== undefined
  )
}

type Stored = { row: RepoRow; created: boolean } | { error: Response }

/**
 * 落库。
 *
 * 先查一次存在性是为了回答 `created`：`upsertRepo` 两种情况都返回同一种行，不看
 * 前后对比就分不出"新建"和"刷新"。也正是这个存在性检查让它能复用已经存下的
 * 仓库，省下一次 GitHub 请求——同一个仓库被登记两次是常态，不是异常。
 */
async function store(fullName: string): Promise<Stored> {
  // A missing GitHub token is an operator misconfiguration, not a bad request.
  try {
    requireGitHubToken()
  } catch (error) {
    return {
      error: apiError(
        503,
        "github_unavailable",
        error instanceof Error ? error.message : "GitHub token missing"
      ),
    }
  }

  const existing = await getRepoByFullName(db, fullName)
  if (existing) return { row: existing, created: false }

  const info = await createGitHubClient().fetchRepoInfo(fullName)
  return { row: await upsertRepo(db, info), created: true }
}