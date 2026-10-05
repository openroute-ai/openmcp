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
import {
  idempotencyKeyOf,
  rememberResponse,
  releaseSlot,
  requestFingerprint,
  reserve,
} from "@/lib/api/idempotency"
import { decodeRepoCursor, parseRepoListPage } from "@/lib/api/pagination"
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
 * **keyset 分页**，游标编码上一页最后一个 `id`。不用 offset 的理由是 offset 会在两次
 * 请求之间错行：新登记的仓库按 id 插进中间位置，于是第二页的第一行与第一页的最后一行
 * 重复，而更糟的是"读到最后返回空数组"会被调用方当成"读完��了"。`total` 是命中过滤器的
 * 总数，让调用方不必翻完才知道有没有更多。
 */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, { scope: "repos:read" })
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams
  const filters = parseFilterQuery(params)
  if (!filters.ok) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "查询参数不合法", {
        detail: filters.detail,
      }),
      auth.rateLimitHeaders
    )
  }

  const page = parseRepoListPage(params)
  if (!page.ok) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "分页参数不合法", {
        detail: page.detail,
      }),
      auth.rateLimitHeaders
    )
  }

  // 坏游标必须报 400，不退回第一页 —— 静默退回会让调用方以为数据只有一页。
  const cursor = page.value.cursor
  const afterId = cursor === undefined ? undefined : decodeRepoCursor(cursor)
  if (cursor !== undefined && afterId === null) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "cursor 不合法", {
        detail: "cursor 是上一页响应里的 nextCursor",
      }),
      auth.rateLimitHeaders
    )
  }

  const pageResult = await listRepoItems(
    db,
    filters.filters,
    // 「自己提交的」认的是 key 的 submitter，不是 key 的归属人：一把 service key
    // 也可能带着某个提交人的身份，而归属人（userId）回答的是另一个问题。
    auth.principal.submitterId,
    { limit: page.value.limit, ...(afterId ? { cursor: afterId } : {}) }
  )

  return withRateLimitHeaders(
    NextResponse.json({
      repos: pageResult.items,
      nextCursor: pageResult.nextCursor,
      total: pageResult.total,
    } satisfies z.output<typeof repoListSchema>),
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

  // 幂等先于一切校验（§3.3）。它在 400 之后：如果 body 根本没被解析成功，指纹就无从
  // 算起，而"一个非法请求不该占住一个幂等键"正好是客户端重试时想要的语义。
  const idempotencyKey = idempotencyKeyOf(request)
  const fingerprint = requestFingerprint(
    "POST",
    "/api/v1/repos",
    body
  )
  const slot = await reserve<z.output<typeof repoRegisteredSchema>>(
    idempotencyKey,
    auth.principal.keyHash,
    fingerprint
  )
  if (slot.kind === "replay") {
    // 回放的是上次那份答案：状态码原样，响应体按存下来的值重新序列化（键序可能与首次
    // 不同，语义一致）。所以走 `slot.status` 而不是再算一次 201/200。
    return withRateLimitHeaders(
      NextResponse.json(slot.body, { status: slot.status }),
      auth.rateLimitHeaders
    )
  }
  if (slot.kind === "conflict") {
    return withRateLimitHeaders(
      apiError(
        409,
        "idempotency_key_reuse",
        `Idempotency-Key "${slot.key}" 已经用过，且不是同一个请求`,
        {
          detail:
            "同一个 Idempotency-Key 只能配一组请求参数；换一个仓库请换一个 key",
        }
      ),
      auth.rateLimitHeaders
    )
  }
  if (slot.kind === "in_flight") {
    // 同一个 key 的另一个请求还在跑。不给 409：那是一个**会自己好**的回答，
    // `Retry-After` 让客户端稍后重试并拿到回放。
    return withRateLimitHeaders(
      apiError(
        409,
        "idempotency_in_flight",
        "同一个 Idempotency-Key 的请求正在处理中",
        { headers: { "retry-after": "2" } }
      ),
      auth.rateLimitHeaders
    )
  }

  // 之后所有失败都要把槽还回去，否则客户端改完 body 重试同一个 key 会撞上 409。
  try {
    const outcome = await register(body, auth.principal.submitterId)
    if ("response" in outcome) {
      await releaseSlot(slot.key, auth.principal.keyHash)
      return withRateLimitHeaders(outcome.response, auth.rateLimitHeaders)
    }

    // 只有成功才记。回放的是"这个请求的答案"，一次 503 github_unavailable 没有答案。
    await rememberResponse(
      slot.key,
      auth.principal.keyHash,
      outcome.status,
      outcome.body
    )

    return withRateLimitHeaders(
      NextResponse.json(outcome.body, { status: outcome.status }),
      auth.rateLimitHeaders
    )
  } catch (error) {
    await releaseSlot(slot.key, auth.principal.keyHash)
    throw error
  }
}

type RegisterOutcome =
  | { status: number; body: z.output<typeof repoRegisteredSchema> }
  | { response: Response }

/**
 * 登记本身，与幂等无关。
 *
 * 单独抽出来是为了让"失败要还槽"这件事只有一处：`POST` 包一层 try，任何非成功分支
 * 都走 `releaseSlot`。把还槽写在每个 return 前面会漏掉其中一个，而漏掉的那个分支
 * 会让客户端永远拿不到 200。
 */
async function register(
  body: unknown,
  submitterId: string | null
): Promise<RegisterOutcome> {
  // 先看 `type`：命中就直接指向另一个端点，而不是让 union 的第一个问题
  // ("url 不是字符串") 把调用方引向一个改完仍然会被拒的请求。
  if (hasType(body)) {
    // 答错端点比答错字段更贵：调用方会拿着同一个 body 重试到底。
    return {
      response: apiError(
        400,
        "type_not_accepted",
        "这个端点不创建 project；带 type 的请求请用 POST /api/v1/projects",
        {
          detail:
            "登记仓库与发布项目是两个 scope：repos:write 与 projects:write",
        }
      ),
    }
  }

  const parsed = repoRegisterRequestSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      response: apiError(400, "invalid_body", '需要 { url } 或 { repo: "owner/name" }', {
        detail: issue
          ? `${issue.path.join(".") || "(body)"}: ${issue.message}`
          : undefined,
      }),
    }
  }

  const resolved = resolveWriteTarget(parsed.data)
  if (!resolved.ok) {
    // 两种 code 都在 400 这一档：`invalid_url` 说地址不对，`invalid_body` 说形状不对。
    return {
      response: apiError(400, resolved.code, resolved.message, {
        detail: resolved.detail,
      }),
    }
  }
  const { fullName, callback } = resolved.target

  const stored = await store(fullName)
  if ("error" in stored) return { response: stored.error }

  // key 带了 submitterId 才记归属；`repos.created_by` 一律不动 ——
  // 它回答"谁登记了这个仓库"，而 API 调用方不是那个人。
  if (submitterId) {
    await linkUserToRepo(db, {
      userId: submitterId,
      repoId: stored.row.id,
      source: "api",
    })
    await recomputePlatformStates(db, [stored.row.id])
  }

  const projectCount = await countProjectsForRepo(db, stored.row.id)

  // 回调放在最后：它报的是"可以开始读了"，而那要等前面的关联与统计口径都对上。
  // 投递失败只进日志——数据已经在库里了，把写成功报成失败只会招来一次重复登记。
  if (callback) {
    const result = await deliverWriteCallback(callback, {
      event: "repo.registered",
      fullName,
      repoId: stored.row.id,
      created: stored.created,
    })
    if (!result.delivered) {
      console.warn("[api/v1/repos] callback failed", {
        fullName,
        status: result.status,
        error: result.error,
      })
    }
  }

  return {
    status: stored.created ? 201 : 200,
    body: {
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
    },
  }
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