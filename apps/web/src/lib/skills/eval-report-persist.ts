import { eq } from 'drizzle-orm'
import { db } from "@/lib/db"
import { skills } from "@workspace/db"
import { computeOpenmcpEvalV1, type OpenmcpEvalReportV1 } from "@/lib/skills/eval-report"

/** Compute heuristic eval and merge into skills.metadata.evalReport (server-only). */
export async function computeAndPersistEvalReport(skillId: string): Promise<OpenmcpEvalReportV1 | null> {
  const [row] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1)
  if (!row) return null

  const readme = row.readme || row.readmeEn
  const report = computeOpenmcpEvalV1({
    securityGrade: row.securityGrade,
    certified: row.certified,
    features: row.features,
    scenario: row.scenario,
    version: row.version,
    platforms: row.platforms,
    readme,
    downloads: row.downloads ?? 0,
  })

  const prev =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {}

  await db
    .update(skills)
    .set({
      metadata: { ...prev, evalReport: report },
      updatedAt: new Date(),
    })
    .where(eq(skills.id, skillId))

  return report
}
