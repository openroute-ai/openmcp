/**
 * Upsert a skill from the console `skill_updated` webhook payload.
 *
 * Identity is `referenceId = repo_full_name + '#' + skill_dir`, matching the
 * design contract and the gateway GitHub connect path. Ingest never publishes
 * directly: status starts at `scanning`, then `runSkillSecurityScan` applies
 * SKILLS_PUBLISH_POLICY (auto-publish or pending_review). Enrichment runs
 * only after a safe/caution grade so category/scenario/features do not gate
 * listing on their own.
 */

import { eq } from 'drizzle-orm'
import { authors, categories, createId, skills } from '@workspace/db'
import { db } from '@/lib/db'
import { filesFromSkillRow, runSkillSecurityScan } from '@/lib/security-scan'
import { runSkillEnrichment } from '@/lib/skills/enrich-skill-by-ai'

export type SkillWebhookData = {
  repo_full_name: string
  repo_name: string
  repo_owner: string
  skill_dir: string
  name: string
  name_zh?: string | null
  description?: string | null
  description_zh?: string | null
  readme?: string | null
  readme_zh?: string | null
  version?: string | null
  category_id?: string | null
  features?: string[] | null
  scenario?: string | null
  license?: string | null
  tools?: string[] | null
}

export type SkillWebhookPayload = {
  event_type: string
  timestamp?: string
  data: SkillWebhookData
}

export type IngestConsoleSkillResult = {
  id: string
  referenceId: string
  slug: string
  created: boolean
  status: 'scanning'
}

/** URL-safe slug from referenceId (`owner/repo#dir` → `owner-repo--dir`). */
export function skillReferenceSlug(referenceId: string): string {
  return referenceId.replace(/\//g, '-').replace(/#/g, '--')
}

export function skillReferenceId(repoFullName: string, skillDir: string): string {
  return `${repoFullName}#${skillDir}`
}

function nonEmpty(s: string | null | undefined): string | null {
  const t = s?.trim()
  return t ? t : null
}

function buildSkillMetadata(data: SkillWebhookData): Record<string, unknown> {
  const skillYaml = [
    `name: ${data.name}`,
    data.description ? `description: ${data.description}` : null,
    data.version ? `version: ${data.version}` : null,
    data.license ? `license: ${data.license}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const meta: Record<string, unknown> = {
    skillYaml,
    sourceFiles: [
      { path: 'skill.yaml', content: skillYaml },
      ...(nonEmpty(data.readme) ? [{ path: 'README.md', content: data.readme as string }] : []),
      ...(nonEmpty(data.readme_zh)
        ? [{ path: 'README.zh.md', content: data.readme_zh as string }]
        : []),
    ],
  }
  if (data.license != null && data.license !== '') meta.license = data.license
  if (data.tools != null) meta.tools = data.tools
  return meta
}

async function ensureAuthorByUsername(username: string): Promise<string> {
  const [existing] = await db
    .select({ id: authors.id })
    .from(authors)
    .where(eq(authors.username, username))
    .limit(1)
  if (existing) return existing.id

  const authorId = createId()
  await db.insert(authors).values({
    id: authorId,
    name: username,
    username,
    avatarUrl: `https://github.com/${encodeURIComponent(username)}.png`,
    github: `https://github.com/${username}`,
  })
  return authorId
}

/**
 * Validate required payload fields. Returns an error message or null.
 */
export function validateSkillWebhookPayload(
  body: unknown
): { ok: true; payload: SkillWebhookPayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid JSON body' }
  }
  const payload = body as SkillWebhookPayload
  if (payload.event_type !== 'skill_updated') {
    return { ok: false, error: 'invalid event_type' }
  }
  const data = payload.data
  if (
    !data?.repo_full_name ||
    !data?.repo_owner ||
    !data?.skill_dir ||
    !data?.name
  ) {
    return {
      ok: false,
      error: 'missing required fields: repo_full_name, repo_owner, skill_dir, name',
    }
  }
  return { ok: true, payload }
}

/**
 * Upsert skill + kick off scan/enrichment without blocking the HTTP response
 * beyond the DB write. Callers should return 200 once this resolves.
 */
export async function ingestConsoleSkill(
  data: SkillWebhookData,
  options: { now?: () => Date; skipAsyncScan?: boolean } = {}
): Promise<IngestConsoleSkillResult> {
  const now = (options.now ?? (() => new Date()))()
  const referenceId = skillReferenceId(data.repo_full_name, data.skill_dir)
  const slug = skillReferenceSlug(referenceId)
  const authorId = await ensureAuthorByUsername(data.repo_owner)
  const githubUrl = `https://github.com/${data.repo_full_name}`
  const titleZh = nonEmpty(data.name_zh) ?? data.name

  const [existing] = await db
    .select()
    .from(skills)
    .where(eq(skills.referenceId, referenceId))
    .limit(1)

  // Prefer webhook category_id when it matches a local category; else null → LLM enrich.
  const rawCategoryId = nonEmpty(data.category_id)
  let resolvedCategoryId: string | null = null
  if (rawCategoryId) {
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, rawCategoryId))
      .limit(1)
    resolvedCategoryId = cat?.id ?? null
  }
  const featureTags = data.features ?? null
  const skillValues = {
    referenceId,
    slug,
    title: titleZh,
    titleEn: data.name,
    description: nonEmpty(data.description_zh),
    descriptionEn: nonEmpty(data.description),
    readme: nonEmpty(data.readme_zh),
    readmeEn: nonEmpty(data.readme),
    version: nonEmpty(data.version),
    features: featureTags,
    tags: featureTags,
    scenario: nonEmpty(data.scenario),
    authorId: existing?.authorId ?? authorId,
    categoryId: resolvedCategoryId,
    status: 'scanning' as const,
    sourceType: 'github' as const,
    githubUrl,
    certified: existing?.certified ?? false,
    publishedAt: existing?.publishedAt ?? null,
    priceType: existing?.priceType ?? ('free' as const),
    popularity: existing?.popularity ?? 0,
    views: existing?.views ?? 0,
    downloads: existing?.downloads ?? 0,
    likes: existing?.likes ?? 0,
    externalSource: 'console',
    syncedFromConsoleAt: now,
    updatedAt: now,
    metadata: buildSkillMetadata(data),
  }

  let skillId: string
  let created: boolean
  if (existing) {
    skillId = existing.id
    created = false
    await db.update(skills).set(skillValues).where(eq(skills.id, existing.id))
  } else {
    skillId = createId()
    created = true
    await db.insert(skills).values({
      id: skillId,
      ...skillValues,
      createdAt: now,
    })
  }

  if (!options.skipAsyncScan) {
    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1)
    const files = skill ? await filesFromSkillRow(skill) : []
    void runSkillSecurityScan({
      skillId,
      files,
      context: { owner: data.repo_owner, license: data.license ?? undefined },
    })
      .then((result) => {
        if (result.grade === 'safe' || result.grade === 'caution') {
          void runSkillEnrichment(skillId).catch((err: unknown) => {
            console.error('[webhook/daily/skills] enrichment failed', skillId, err)
          })
        }
      })
      .catch((err: unknown) => {
        console.error('[webhook/daily/skills] scan failed', skillId, err)
      })
  }

  return { id: skillId, referenceId, slug, created, status: 'scanning' }
}
