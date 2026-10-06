/**
 * `POST /api/v1/skills/scan` — 给内部服务（Web）执行一次 Skill 安全扫描。
 *
 * 需要 `skills:scan`。这个 scope 只配给 Web 侧的服务 key，不在任何自助签发的默认
 * 范围内（见 `SELF_SERVICE_SCOPES`）：一次扫描要花掉一个有配额、有时限、跨网段的
 * sandbox，把它交给自助 key 就是把成本的控制权给了不需要为之负责的人。
 *
 * **请求不携带文件，只携带地址。** 源码必须由 Console 自己取——调用方手里那份
 * 文件快照是它自己某一时刻的副本，让它落进扫描结论，就等于允许「同一个提交」在
 * 两次扫描里得到两个不同的结果。这是一条不能从中间断的链：
 * 地址相同 → 取到的提交相同 → 扫到的文件相同 → 结论可复现。
 *
 * 失败语义（与 Web 的 recovery 约定一致）：
 *
 * - 仓库取不到（私有/不存在/网络失败）→ `502 source_unavailable`。这不是一次
 *   扫描，是一次没能开始的扫描，Web 侧应把技能留在 `scanning/unknown`，**不许**判成
 *   `rejected`——一个「我们没读到的东西」不能变成「我们读过并且很危险的东西」。
 * - `skillDir` 越界 → `400 invalid_skill_dir`。请求体是不可信输入，把它当路径拼接就
 *   是文件读取漏洞，这个 400 在日志里应当只有恶意调用能出现。
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import {
  apiError,
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import { skillScanRequestSchema, skillScanResponseSchema } from "@/lib/api/contract"
import {
  InvalidSkillDirError,
  scanRepositoryWithReview,
  SkillSourceUnavailableError,
} from "@/lib/skill-scan"

/** 每次都要取仓库、跑扫描，任何一层缓存都会让结论脱离请求里的 ref。 */
export const dynamic = "force-dynamic"

/** 克隆/读回/复核都吃时间预算；sandbox 自身 120s 超时，这里留足余量。 */
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, { scope: "skills:scan" })
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

  const parsed = skillScanRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "需要 repoFullName（owner/repo）", {
        detail: issue
          ? `${issue.path.join(".") || "(body)"}: ${issue.message}`
          : undefined,
      }),
      auth.rateLimitHeaders
    )
  }

  const input = parsed.data
  try {
    const report = await scanRepositoryWithReview({
      repoFullName: input.repoFullName,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(input.skillDir ? { skillDir: input.skillDir } : {}),
      ...(input.includeLlm === false ? { includeLlm: false } : {}),
    })

    return withRateLimitHeaders(
      NextResponse.json(
        {
          repoFullName: input.repoFullName,
          skillDir: input.skillDir,
          ref: input.ref,
          source: report.source,
          context: report.context,
          grade: report.grade,
          flags: report.flags,
          trustTier: report.trustTier,
          llmGrade: report.llmGrade,
          llmAnalysis: report.llmAnalysis,
          scannedAt: report.scannedAt,
          rulesVersion: report.rulesVersion,
          fileCount: report.fileCount,
          truncated: report.truncated,
          truncatedReason: report.truncatedReason,
          files: report.files,
        } satisfies z.output<typeof skillScanResponseSchema>
      ),
      auth.rateLimitHeaders
    )
  } catch (error) {
    if (error instanceof InvalidSkillDirError) {
      return withRateLimitHeaders(
        apiError(400, "invalid_skill_dir", error.message),
        auth.rateLimitHeaders
      )
    }
    if (error instanceof SkillSourceUnavailableError) {
      return withRateLimitHeaders(
        apiError(
          502,
          "source_unavailable",
          error.message,
          error.cause instanceof Error ? { detail: error.cause.message } : {}
        ),
        auth.rateLimitHeaders
      )
    }
    // 其它都算服务端失败：LLM key 缺失不该变成调用方的错，in-sandbox 脚本回落后
    // 仍失败也不该。扫描断层会让 Web 侧把技能留在 review 队列，而不是给它一个结论。
    console.error("[api/v1/skills/scan] failed", {
      repoFullName: input.repoFullName,
      error: error instanceof Error ? error.message : String(error),
    })
    return withRateLimitHeaders(
      apiError(502, "scan_failed", "扫描执行失败"),
      auth.rateLimitHeaders
    )
  }
}