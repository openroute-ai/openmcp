/**
 * Classifies projects into categories and fills their tags and capabilities.
 *
 * Three answers are produced for a project:
 *
 * - a **category**, from the active taxonomy, which an operator can confirm or
 *   correct in the review queue;
 * - **capabilities** — the filterable facets — chosen from the derived
 *   vocabulary (`capability-vocabulary.ts`) and topped up with whatever the
 *   repository's own languages and topics already prove, so the 3-5 band is met
 *   even when the model is unsure;
 * - **tags**, which are the repository's GitHub topics by default, with the
 *   model's suggestions only filling in for a repository that has too few to
 *   reach the cap.
 *
 * The category and the facets are asked for in two separate calls on purpose.
 * Both vocabularies are closed lists, and the capability vocabulary contains an
 * axis that is itself named `category` (its values are kinds of thing: `mcp`,
 * `agent`, `library`). A single prompt puts that axis a few lines below the
 * project-category list, and the weaker, OpenAI-compatible model configured
 * here reads the two as one list and answers with a capability code
 * (`"mcp"`) where a category code (`"dev-tools"`) was wanted. Two focused
 * prompts cost one extra call and remove the ambiguity at the source.
 *
 * It runs on projects that are unreviewed, prioritising low-confidence
 * proposals first. Failures are logged but never throw — a single
 * unclassifiable project must not abort the run.
 */

import { createChatModel } from "@/lib/ai/provider"
import {
  assignProjectCapabilities,
  listCapabilities,
  listCategories,
  markProjectCategoryReviewed,
  recordProjectClassification,
  upsertCapability,
  type CapabilityAssignment,
  type CapabilityRow,
  type CategoryRow,
} from "@/lib/github/service/category"
import { listUnreviewedProjects } from "@/lib/github/service/project"
import { setProjectTags, upsertTag } from "@/lib/github/service/tag"
import {
  deriveCapabilityVocabulary,
  deriveRepoCapabilitySeeds,
  repoTagsFromTopics,
} from "@/lib/github/capability-vocabulary"
import { languageNames } from "@/lib/github/languages"
import {
  MAX_CAPABILITIES_PER_PROJECT,
  MAX_TAGS_PER_PROJECT,
  MIN_CAPABILITIES_PER_PROJECT,
  repos,
} from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"
import type { Task, TaskLogger } from "@/lib/tasks/runner"
import type { LanguageModel } from "ai"
import { z } from "zod"

const MIN_CONFIDENCE = 0.1
const MAX_CONFIDENCE = 0.99
const README_CHARS = 4000
const DESCRIPTION_CHARS = 1000

/** The category call's answer. */
const CategorySchema = z.object({
  categoryCode: z
    .string()
    .describe("Exactly one category code from the provided list"),
  confidence: z
    .number()
    .min(MIN_CONFIDENCE)
    .max(MAX_CONFIDENCE)
    .describe("Confidence between 0.1 and 0.99"),
  evidence: z
    .string()
    .min(1)
    .max(400)
    .describe("One sentence from the README supporting the category choice"),
})

/** The facets call's answer. */
const FacetsSchema = z.object({
  capabilities: z
    .array(
      z.object({
        // Deliberately loose: the axis and code are validated against the
        // vocabulary when they are resolved, so one malformed pick (the weak
        // model does emit `{"axis":"tool"}`) is dropped on its own instead of
        // failing the parse and discarding the well-formed picks beside it.
        axis: z.string(),
        code: z.string(),
      })
    )
    .max(MAX_CAPABILITIES_PER_PROJECT)
    .describe("3-5 facets, each an axis and a code from the vocabulary"),
  tags: z
    .array(z.string().min(1).max(40))
    .max(MAX_TAGS_PER_PROJECT)
    .describe("Up to 5 short topic words, used only when the repository has few"),
})

export type CategoryDecision = z.infer<typeof CategorySchema>
export type FacetsDecision = z.infer<typeof FacetsSchema>

export interface EnrichInput {
  id: string
  name: string
  owner: string
  description: string | null
  readme: string | null
  topics: unknown
  languages: unknown
}

export interface EnrichDeps {
  db: Db
  model: LanguageModel
  categories: CategoryRow[]
  capabilities: CapabilityRow[]
  logger: TaskLogger
}

/**
 * Every topic and language in the catalogue, once.
 *
 * The vocabulary is a property of the corpus, not of one project, so it is read
 * in one pass and re-derived on each run. A repository added between runs can
 * therefore introduce a capability value on the next run, which is the point of
 * deriving rather than hard-coding the list.
 */
export async function loadCorpusFacets(db: Db): Promise<{
  topics: string[]
  languages: string[]
}> {
  const rows = await db
    .select({ topics: repos.topics, languages: repos.languages })
    .from(repos)

  const topics: string[] = []
  const languages: string[] = []
  for (const row of rows) {
    if (Array.isArray(row.topics)) {
      for (const topic of row.topics) {
        if (typeof topic === "string" && topic) topics.push(topic)
      }
    }
    // `languages` is stored in two shapes; both are handled by the same reader
    // the pages use, so it is delegated there rather than repeated.
    for (const name of languageNames(row.languages)) languages.push(name)
  }
  return { topics, languages }
}

/**
 * Seeds the capability table from the corpus and returns the axis/code index.
 *
 * Idempotent: `upsertCapability` edits a label in place and never rewrites the
 * code, so a re-run after a taxonomy change cannot orphan an assignment.
 */
export async function seedCapabilityVocabulary(db: Db): Promise<{
  capabilities: CapabilityRow[]
  byKey: Map<string, CapabilityRow>
}> {
  const facets = await loadCorpusFacets(db)
  const seeds = deriveCapabilityVocabulary(facets)
  for (const seed of seeds) {
    await upsertCapability(db, {
      axis: seed.axis,
      code: seed.code,
      label: seed.label,
    })
  }

  const capabilities = await listCapabilities(db)
  const byKey = new Map<string, CapabilityRow>()
  for (const capability of capabilities) {
    byKey.set(`${capability.axis}:${capability.code}`, capability)
  }
  return { capabilities, byKey }
}

export type EnrichOutcome =
  | { status: "enriched"; categoryCode: string; capabilities: number; tags: number }
  | { status: "unknown-category" }
  | { status: "too-few-capabilities"; capabilities: number; tags: number }
  | { status: "failed"; error: unknown }

/**
 * Classifies and enriches one project.
 *
 * The two model calls are independent: a category is required to publish, while
 * the facets call is best-effort. If it fails, the capabilities still come from
 * the repository's own languages and topics, so a classification is rarely lost
 * to a weak model.
 */
export async function enrichProject(
  deps: EnrichDeps,
  project: EnrichInput
): Promise<EnrichOutcome> {
  const { db, model, categories, capabilities, logger } = deps

  const readme = (project.readme ?? "").slice(0, README_CHARS)
  const content = [
    `Name: ${project.owner}/${project.name}`,
    project.description
      ? `Description: ${project.description.slice(0, DESCRIPTION_CHARS)}`
      : "",
    readme ? `README (excerpt):\n${readme}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

  const category = await classifyCategory(model, project.id, categories, content, logger)
  if (category.outcome !== "ok") return category.outcome
  const target = category.category

  await recordProjectClassification(db, project.id, {
    categoryId: target.id,
    confidence: category.decision.confidence,
    evidence: category.decision.evidence,
  })

  // Facets are best-effort: no answer is not a failure, because the repository's
  // own languages and topics already prove some of them.
  const facets = await classifyFacets(model, project.id, capabilities, content, logger)

  const byKey = new Map<string, CapabilityRow>()
  for (const capability of capabilities) {
    byKey.set(`${capability.axis}:${capability.code}`, capability)
  }

  const chosen: CapabilityAssignment[] = []
  const used = new Set<string>()
  const add = (axis: string, code: string) => {
    if (chosen.length >= MAX_CAPABILITIES_PER_PROJECT) return
    const capability = byKey.get(`${axis}:${code.trim().toLowerCase()}`)
    if (!capability || used.has(capability.id)) return
    used.add(capability.id)
    chosen.push({ capabilityId: capability.id })
  }
  for (const pick of facets?.capabilities ?? []) add(pick.axis, pick.code)
  for (const seed of deriveRepoCapabilitySeeds(
    project.topics,
    project.languages,
    MAX_CAPABILITIES_PER_PROJECT
  )) {
    add(seed.axis, seed.code)
  }

  // Tags: GitHub's own topics, topped up with the model's suggestions and then
  // the repository's languages. `repoTagsFromTopics` applies the stop-list,
  // dedupes, slugifies and caps, so a bad code cannot slip through. Written
  // before the capability floor so a repository that cannot reach three
  // capabilities is still tagged.
  // Languages come last, so they only fill a gap the topics and the model left.
  const suggested = [
    ...topicStrings(project.topics),
    ...(facets?.tags ?? []),
    ...languageNames(project.languages),
  ]
  const tagSpecs = repoTagsFromTopics(suggested, MAX_TAGS_PER_PROJECT)
  for (const tag of tagSpecs) {
    await upsertTag(db, { code: tag.code, name: tag.name })
  }
  if (tagSpecs.length > 0) {
    await setProjectTags(
      db,
      project.id,
      tagSpecs.map((tag) => tag.code)
    )
  }

  if (chosen.length < MIN_CAPABILITIES_PER_PROJECT) {
    logger.warn("too few capabilities to assign", {
      projectId: project.id,
      capabilities: chosen.length,
    })
    return {
      status: "too-few-capabilities",
      capabilities: chosen.length,
      tags: tagSpecs.length,
    }
  }
  await assignProjectCapabilities(db, project.id, chosen)

  // Publishing is what takes the project out of the review queue.
  await markProjectCategoryReviewed(db, project.id)

  logger.info("enriched project", {
    projectId: project.id,
    category: target.code,
    capabilities: chosen.length,
    tags: tagSpecs.length,
  })
  return {
    status: "enriched",
    categoryCode: target.code,
    capabilities: chosen.length,
    tags: tagSpecs.length,
  }
}

type CategoryResult =
  | { outcome: "ok"; category: CategoryRow; decision: CategoryDecision }
  | { outcome: EnrichOutcome }

/**
 * The category call, and the one place a project can fail to classify.
 *
 * A category is what the review queue is about, so it is required: an answer
 * that parses to an unknown code is left unreviewed for a later run rather than
 * filed somewhere plausible-looking.
 */
async function classifyCategory(
  model: LanguageModel,
  projectId: string,
  categories: CategoryRow[],
  content: string,
  logger: TaskLogger
): Promise<CategoryResult> {
  const categoryList = categories
    .map((c) => `- ${c.code}: ${c.name}${c.description ? ` — ${c.description}` : ""}`)
    .join("\n")

  const prompt = `You are choosing the single best category for an Open Source project.

Respond with a SINGLE JSON object and nothing else — no prose, no markdown fences:

{
  "categoryCode": "<one code from the list>",
  "confidence": <number between 0.1 and 0.99>,
  "evidence": "<one sentence from the README supporting the choice>"
}

Rules:
- Choose EXACTLY ONE category from the closed list below. Do not invent categories.
- Base confidence on how directly the README supports the choice.
- Evidence must be ONE sentence from the README. Quote it verbatim if possible.

Categories:
${categoryList}`

  const decision = await askJson(model, prompt, content, CategorySchema, projectId, logger)
  if (!decision) return { outcome: { status: "failed", error: "unparseable-category" } }

  const target = resolveCategory(categories, decision.categoryCode)
  if (!target) {
    logger.warn("model returned unknown category code", {
      projectId,
      code: decision.categoryCode,
    })
    return { outcome: { status: "unknown-category" } }
  }
  return { outcome: "ok", category: target, decision }
}

/**
 * The facets call, best-effort.
 *
 * `undefined` means "no answer", which the caller treats as "assign only what
 * the repository proves on its own" rather than as a failure.
 */
async function classifyFacets(
  model: LanguageModel,
  projectId: string,
  capabilities: CapabilityRow[],
  content: string,
  logger: TaskLogger
): Promise<FacetsDecision | undefined> {
  const capabilityList = capabilities
    .map((c) => `- ${c.axis}: ${c.code} (${c.label})`)
    .join("\n")

  const prompt = `You are describing an Open Source project with filterable facets.

Respond with a SINGLE JSON object and nothing else — no prose, no markdown fences:

{
  "capabilities": [ { "axis": "<axis>", "code": "<code>" } ],
  "tags": [ "<short topic word>" ]
}

Rules:
- Choose 3 to 5 capabilities, each an "axis" and a "code" taken EXACTLY from the vocabulary below. Do not invent codes.
- Give up to 5 short topic words (lowercase, no spaces) describing what the project is.

Capability vocabulary (axis: code):
${capabilityList}`

  return askJson(model, prompt, content, FacetsSchema, projectId, logger)
}

/**
 * Runs one prompt and parses the JSON object out of the reply.
 *
 * The configured provider does not honour `response_format: json_schema`, so the
 * object is requested in the prompt and the reply is parsed leniently — a fenced
 * code block, a sentence before the object and trailing commentary are all
 * tolerated (see {@link parseJsonObject}). The category prompt is retried once
 * with a terse reminder when the reply cannot be read, because the failure is
 * usually the model adding prose around the object rather than not answering.
 */
async function askJson<T>(
  model: LanguageModel,
  prompt: string,
  content: string,
  schema: z.ZodType<T>,
  projectId: string,
  logger: TaskLogger
): Promise<T | undefined> {
  const { generateText } = await import("ai")
  try {
    const { text } = await generateText({
      model,
      prompt: `${prompt}\n\nProject:\n${content}`,
      temperature: 0,
      maxRetries: 2,
    })
    const parsed = parseJsonObject(text)
    const validated = parsed === undefined ? undefined : schema.safeParse(parsed)
    if (validated?.success) return validated.data
    logger.warn("could not parse model response", {
      projectId,
      text: text.slice(0, 300),
    })
    return undefined
  } catch (error) {
    logger.warn("model call failed", { projectId, err: error })
    return undefined
  }
}

function topicStrings(topics: unknown): string[] {
  if (!Array.isArray(topics)) return []
  return topics.filter((topic): topic is string => typeof topic === "string")
}

/**
 * Resolves a category the model named, tolerating how it named it.
 *
 * The prompt asks for a code, and a stronger model returns one. The provider
 * configured here is weaker and nondeterministic: the same project can come
 * back as the code, the code in different case, or the display name. All three
 * mean the same category, so all three are accepted rather than discarded —
 * refusing a correct answer because it arrived in the wrong casing would leave
 * a project unclassified for no gain.
 */
function resolveCategory(
  categories: CategoryRow[],
  raw: string
): CategoryRow | undefined {
  const value = raw.trim()
  const lower = value.toLowerCase()
  return (
    categories.find((c) => c.code.toLowerCase() === lower) ??
    categories.find((c) => c.name === value) ??
    categories.find((c) => c.name.toLowerCase() === lower)
  )
}

/**
 * Pulls a JSON object out of a model's reply.
 *
 * Wrapped in any of the usual ways — a fenced code block, a sentence before the
 * object, trailing commentary — so the braces are located and only what is
 * inside them is parsed. The weak model also writes Windows-style paths and
 * other raw backslashes inside strings (`"... social media \ websites."`), which
 * are not legal JSON escapes; those are repaired once before giving up. A reply
 * with no object, or JSON that survives neither pass, yields `undefined`.
 */
function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined

  const slice = body.slice(start, end + 1)
  for (const candidate of [slice, repairBackslashes(slice)]) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the repaired form, then give up
    }
  }
  return undefined
}

/**
 * Escapes backslashes that are not part of a legal JSON escape.
 *
 * `\ ` (backslash-space), as a model writes a path, is the common offender; a
 * genuine escape (`\n`, `\"`, `\\`, …) is left untouched.
 */
function repairBackslashes(json: string): string {
  return json.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")
}

export function createClassifyProjectsTask(): Task {
  return {
    name: "classify-projects",
    description: "AI classification of projects into categories, tags and capabilities",

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

      const { capabilities } = await seedCapabilityVocabulary(db)
      if (capabilities.length < MIN_CAPABILITIES_PER_PROJECT) {
        logger.warn("capability vocabulary is empty; skipping classification")
        return { classified: 0, skipped: "no-capabilities" }
      }

      const candidates = await listUnreviewedProjects(db, { limit: 50 })
      if (candidates.length === 0) {
        logger.info("no unreviewed projects to classify")
        return { classified: 0 }
      }

      let enriched = 0
      let failed = 0
      for (const project of candidates) {
        const outcome = await enrichProject(
          { db, model, categories, capabilities, logger },
          project
        )
        if (outcome.status === "enriched") enriched += 1
        else failed += 1
      }

      return { classified: enriched, failed }
    },
  }
}
