/**
 * Route B handler: `POST /api/scan`.
 *
 * Request and response contracts mirror the domestic console's
 * `POST /api/v1/skills/scan` (see `apps/console/src/lib/api/contract.ts`). The
 * console keeps authz, rate limiting and persistence; this route only executes
 * the scan and returns the report.
 */
import type { Context } from "hono"
import { z } from "zod"
import { requireEgressSecret } from "../lib/authz"
import {
  InvalidSkillDirError,
  scanRepositoryWithReview,
  SkillSourceUnavailableError,
} from "../lib/skill-scan/orchestrate"

const repoSlugSchema = z
  .string()
  .min(3, "need owner/repo")
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "need owner/repo")

const scanRequestSchema = z
  .object({
    repoFullName: repoSlugSchema,
    ref: z.string().min(1).max(200).optional(),
    skillDir: z.string().min(1).max(400).optional(),
    includeLlm: z.boolean().optional(),
  })
  .strict()

/**
 * 沙箱进程对 `maxDuration`（300s）而言已经很长，但它的超时不该依赖平台的
 * 回收：这个信号给 `@vercel/sandbox` 的 create / runCommand 一条独立的中断
 * 路径，超时后沙箱被中止而不是让函数一直挂到平台动手。
 *
 * 留 20s 给阶段 2——规则在沙箱内跑完后的 LLM 复核在这台函数上执行。
 */
const SCAN_BUDGET_MS = 280_000

export async function scanRoute(c: Context): Promise<Response> {
  const unauthorized = requireEgressSecret(c)
  if (unauthorized) return unauthorized

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json(
      { error: "invalid_body", message: "body is not valid JSON" },
      400
    )
  }

  const parsed = scanRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return c.json(
      {
        error: "invalid_body",
        message: "need repoFullName (owner/repo)",
        detail: issue
          ? `${issue.path.join(".") || "(body)"}: ${issue.message}`
          : undefined,
      },
      400
    )
  }

  const input = parsed.data
  try {
    const report = await scanRepositoryWithReview({
      repoFullName: input.repoFullName,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(input.skillDir ? { skillDir: input.skillDir } : {}),
      ...(input.includeLlm === false ? { includeLlm: false } : {}),
      signal: AbortSignal.timeout(SCAN_BUDGET_MS),
    })
    return c.json({
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
    })
  } catch (error) {
    if (error instanceof InvalidSkillDirError) {
      return c.json({ error: "invalid_skill_dir", message: error.message }, 400)
    }
    if (error instanceof SkillSourceUnavailableError) {
      // The cause (usually a sandbox-creation error message) is operator
      // information, not caller information: it teaches an attacker about
      // this function's internals. Log it server-side, send back the class.
      console.error("[egress-scan] source unavailable", {
        repoFullName: input.repoFullName,
        error:
          error.cause instanceof Error ? error.cause.message : error.message,
      })
      return c.json(
        { error: "source_unavailable", message: error.message },
        502
      )
    }
    console.error("[egress-scan] failed", {
      repoFullName: input.repoFullName,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { error: "scan_failed", message: "scan execution failed" },
      502
    )
  }
}
