/**
 * Classifies projects into categories and assigns capabilities, with human-in-the-loop review.
 *
 * The classifier uses the active category taxonomy as a closed vocabulary and
 * produces 3-5 capabilities per axis set, staying within the limits enforced
 * by the service layer (see {@link assignProjectCapabilities}). It runs on
 * projects that are unreviewed, prioritising low-confidence proposals first.
 *
 * The prompt explicitly asks for an evidence sentence taken from the README,
 * so that a reviewer can decide in seconds rather than reading the whole
 * document. Failures are logged but never throw — a single unclassifiable
 * project must not abort the run.
 */

import { createChatModel } from "@/lib/ai/provider"
import { listCategories, recordProjectClassification } from "@/lib/github/service/category"
import { listUnreviewedProjects } from "@/lib/github/service/project"
import type { Task } from "@/lib/tasks/runner"
import { z } from "zod"

const MIN_CONFIDENCE = 0.1
const MAX_CONFIDENCE = 0.99

/**
 * Categories are given as the classifier's allowed answers.
 */
const CategorySchema = z.object({
  categoryCode: z.string().describe("Exactly one category code from the provided list"),
  confidence: z
    .number()
    .min(MIN_CONFIDENCE)
    .max(MAX_CONFIDENCE)
    .describe("Confidence between 0.1 and 0.99"),
  evidence: z
    .string()
    .min(1)
    .max(400)
    .describe("One sentence from the README supporting this choice"),
})

export type CategoryDecision = z.infer<typeof CategorySchema>

export function createClassifyProjectsTask(): Task {
  return {
    name: "classify-projects",
    description: "AI classification of projects into categories and capabilities",

    async run({ db, logger }) {
      const model = createChatModel()
      if (!model) {
        logger.warn("ai model is not configured; skipping classification")
        return { classified: 0, skipped: "no-model" }
      }

      const categories = await listCategories(db, { activeOnly: true })
      if (categories.length === 0) {
        logger.warn("no active categories exist; skipping classification")
        return { classified: 0, skipped: "no-categories" }
      }

      // Only re-classify projects that are not yet reviewed.
      const candidates = await listUnreviewedProjects(db, { limit: 50 })
      if (candidates.length === 0) {
        logger.info("no unreviewed projects to classify")
        return { classified: 0 }
      }

      const categoryList = categories
        .map((c) => `- ${c.code}: ${c.name}${c.description ? ` — ${c.description}` : ""}`)
        .join("\n")

      let classified = 0
      for (const project of candidates) {
        const readme = (project.readme ?? "").slice(0, 4000)
        const content = [
          `Name: ${project.owner}/${project.name}`,
          project.description ? `Description: ${project.description.slice(0, 1000)}` : "",
          readme ? `README (excerpt):\n${readme}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")

        const prompt = `You are classifying an Open Source project.

Rules:
- Choose EXACTLY ONE category from the closed list below. Do not invent categories.
- Confidence between 0.1 and 0.99. Base it on how directly the README supports the choice.
- Evidence must be ONE sentence taken from the README that supports the choice. Quote it verbatim if possible, or rephrase minimally.
- Never output the category name — only the category code.
- If uncertain, pick the closest and lower confidence. Do not refuse.

Categories:
${categoryList}`

        try {
          const result = await (async () => {
            const { generateObject } = await import("ai")
            return generateObject({
              model,
              schema: CategorySchema,
              prompt: `${prompt}\n\nProject:\n${content}`,
              temperature: 0,
              maxRetries: 2,
            })
          })()

          const decision = result.object
          const target = categories.find((c) => c.code === decision.categoryCode)
          if (!target) {
            logger.warn("model returned unknown category code", { projectId: project.id })
            continue
          }

          await recordProjectClassification(db, project.id, {
            categoryId: target.id,
            confidence: decision.confidence,
            evidence: decision.evidence,
          })
          classified += 1
          logger.info("classified project", { projectId: project.id, category: target.code, confidence: decision.confidence })
        } catch (error) {
          logger.warn("failed to classify project", { projectId: project.id, err: error })
        }
      }

      return { classified }
    },
  }
}
