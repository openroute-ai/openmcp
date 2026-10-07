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
import { egressSecret } from "../env"
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

export async function scanRoute(c: Context): Promise<Response> {
  const expected = egressSecret()
  const supplied = c.req.header("x-egress-secret")
  if (!expected || supplied !== expected) {
    return c.json({ error: "unauthorized" }, 401)
  }

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json({ error: "invalid_body", message: "body is not valid JSON" }, 400)
  }

  const parsed = scanRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return c.json(
      {
        error: "invalid_body",
        message: "need repoFullName (owner/repo)",
        detail: issue ? `${issue.path.join(".") || "(body)"}: ${issue.message}` : undefined,
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
      return c.json(
        {
          error: "source_unavailable",
          message: error.message,
          detail: error.cause instanceof Error ? error.cause.message : undefined,
        },
        502
      )
    }
    console.error("[egress-scan] failed", {
      repoFullName: input.repoFullName,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json({ error: "scan_failed", message: "scan execution failed" }, 502)
  }
}