/**
 * One-time data import from the console database into the web marketplace.
 *
 * Reads (read-only) from `CONSOLE_DATABASE_URL` (the supabase console):
 *   - the 9 active category rows in `categories`
 *   - the 46 `type = 'skill'` rows in `projects`
 *
 * Writes into the apps/web database (`DATABASE_URL`, localhost in dev):
 *   - `categories` — one row per console category, ids preserved so console
 *     `category_id` values ("cat-*") resolve directly.
 *   - `authors` — one row per repo owner, created on demand like the skills
 *     webhook does (`ensureAuthorByUsername`).
 *   - `skills` — one row per console skill project, shaped exactly like
 *     `ingest-console-skill`'s `SkillWebhookData` mapping (referenceId =
 *     `owner/repo#skills`, URL-safe slug, `externalSource: 'console'`,
 *     `syncedFromConsoleAt`, author by owner, category resolved by id).
 *
 * Imported skills land at `status = 'pending_review'` + `reviewStatus =
 * 'pending_review'` so the scan-gate is respected: there is no SKILL.md
 * content to scan in the source, so nothing can be auto-published. An admin
 * publishes them through the review queue.
 *
 * This script modifies ONLY the apps/web database. It never writes to the
 * console database.
 *
 * Usage:
 *   DATABASE_URL="postgresql://openmcp:openmcp@127.0.0.1:5434/openmcp" \
 *   CONSOLE_DATABASE_URL="postgres://...supabase..." \
 *   node --import tsx scripts/import-console-skills.ts
 */

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { authors, categories, createId, skills } from '@workspace/db'

const webDb = drizzle(new Pool({ connectionString: process.env.DATABASE_URL! }), {
  schema: { authors, categories, skills },
})

const consolePool = new Pool({
  connectionString: process.env.CONSOLE_DATABASE_URL!,
  ssl: { rejectUnauthorized: false },
})

const CATEGORY_NAME_EN: Record<string, string> = {
  'life-services': 'Life Services',
  'office-collaboration': 'Office Collaboration',
  'dev-tools': 'Development Tools',
  'gpu-compute': 'GPU Compute',
  'ai-media': 'AI & Media',
  search: 'Search',
  'product-design': 'Product Design',
  'fintech-payments': 'Fintech & Payments',
  'coding-agents': 'Coding Agents',
}

const CATEGORY_DESC_EN: Record<string, string> = {
  'life-services':
    'MCP services for everyday life: transport, dining, travel, shopping and more.',
  'office-collaboration':
    'Team collaboration, documents and knowledge management: Feishu, Yuque, DingTalk, Notion, Google Workspace and more.',
  'dev-tools':
    'Developer tooling and infrastructure: GitHub, Playwright, Context7, Serena and more.',
  'gpu-compute':
    'On-demand GPU and cloud sandbox compute: RunPod, Novita, Sandbox and more.',
  'ai-media':
    'Model-as-a-service for inference, image and video generation: Tongyi Wanxiang, Jimeng, MegaNova, Atlas Cloud and more.',
  search:
    'Web and information retrieval: Baidu, Brave Search, Tavily, Firecrawl and more.',
  'product-design':
    'Design collaboration, UI references and design systems: Figma, Lazyweb, Mobbin and more.',
  'fintech-payments':
    'Payments and fintech: Gate Pay, Omise, Alipay / WeChat Pay and more.',
  'coding-agents':
    'Coding agents and harnesses: Codex, Claude Code, DeepSeek and more.',
}

type ConsoleCategory = {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  sort_order: number
}

type ConsoleSkillProject = {
  owner: string
  repo_name: string
  category_id: string | null
  description: string | null
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '(No description)') return null
  return trimmed
}

/** URL-safe slug from referenceId (`owner/repo#dir` → `owner-repo--dir`). */
function skillReferenceSlug(referenceId: string): string {
  return referenceId.replace(/\//g, '-').replace(/#/g, '--')
}

function buildSkillMetadata(name: string, description: string | null, githubUrl: string) {
  const skillYaml = [
    `name: ${name}`,
    description ? `description: ${description}` : null,
    `url: ${githubUrl}`,
  ]
    .filter(Boolean)
    .join('\n')
  return {
    skillYaml,
    sourceFiles: [{ path: 'skill.yaml', content: skillYaml }],
  }
}

async function ensureAuthorByUsername(username: string): Promise<string> {
  const [existing] = await webDb
    .select({ id: authors.id })
    .from(authors)
    .where(eq(authors.username, username))
    .limit(1)
  if (existing) return existing.id

  const id = createId()
  await webDb.insert(authors).values({
    id,
    name: username,
    username,
    avatarUrl: `https://github.com/${encodeURIComponent(username)}.png`,
    github: `https://github.com/${username}`,
  })
  return id
}

async function importCategories(): Promise<number> {
  const { rows } = await consolePool.query<ConsoleCategory>(
    `SELECT id, code, name, description, is_active, sort_order
     FROM categories
     WHERE is_active = true
     ORDER BY sort_order`
  )
  if (rows.length === 0) {
    throw new Error('console categories table is empty; nothing to import')
  }

  for (const row of rows) {
    await webDb
      .insert(categories)
      .values({
        id: row.id,
        referenceId: row.code,
        name: row.name,
        nameEn: CATEGORY_NAME_EN[row.code] ?? row.code,
        slug: row.code,
        description: row.description,
        descriptionEn: CATEGORY_DESC_EN[row.code] ?? null,
        order: row.sort_order,
        isActive: row.is_active,
      })
      .onConflictDoUpdate({
        target: categories.id,
        set: {
          referenceId: row.code,
          name: row.name,
          nameEn: CATEGORY_NAME_EN[row.code] ?? row.code,
          slug: row.code,
          description: row.description,
          descriptionEn: CATEGORY_DESC_EN[row.code] ?? null,
          order: row.sort_order,
          isActive: row.is_active,
        },
      })
  }
  return rows.length
}

async function importSkills(): Promise<{ imported: number; failed: number }> {
  const { rows: projects } = await consolePool.query<ConsoleSkillProject>(
    `SELECT r.owner AS owner, r.name AS repo_name, p.category_id AS category_id, p.description AS description
     FROM projects p
     JOIN repos r ON r.id = p.repo_id
     WHERE p.type = 'skill' AND p.status = 'active'
     ORDER BY r.name`
  )

  let imported = 0
  let failed = 0
  for (const project of projects) {
    try {
      const repoFullName = `${project.owner}/${project.repo_name}`
      const skillDir = 'skills'
      const referenceId = `${repoFullName}#${skillDir}`
      const slug = skillReferenceSlug(referenceId)
      const name = project.repo_name
      const description = nonEmpty(project.description)
      const githubUrl = `https://github.com/${repoFullName}`

      const authorId = await ensureAuthorByUsername(project.owner)

      let categoryId: string | null = null
      if (project.category_id) {
        const [cat] = await webDb
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.id, project.category_id))
          .limit(1)
        categoryId = cat?.id ?? null
      }

      const [existing] = await webDb
        .select()
        .from(skills)
        .where(eq(skills.referenceId, referenceId))
        .limit(1)

      const values = {
        referenceId,
        slug,
        title: name,
        titleEn: name,
        description: null,
        descriptionEn: description,
        authorId,
        categoryId,
        priceType: 'free' as const,
        certified: false,
        securityGrade: 'unknown' as const,
        trustTier: 0,
        sourceType: 'github' as const,
        githubUrl,
        visibility: 'public' as const,
        status: 'pending_review' as const,
        reviewStatus: 'pending_review' as const,
        externalSource: 'console',
        syncedFromConsoleAt: new Date(),
        metadata: buildSkillMetadata(name, description, githubUrl),
        tags: null,
        features: null,
      }

      if (existing) {
        await webDb.update(skills).set(values).where(eq(skills.id, existing.id))
      } else {
        await webDb.insert(skills).values(values)
      }
      imported += 1
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `[import-console-skills] failed for ${project.owner}/${project.repo_name}: ${message}`
      )
    }
  }
  return { imported, failed }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  if (!process.env.CONSOLE_DATABASE_URL) throw new Error('CONSOLE_DATABASE_URL is required')

  const categoriesImported = await importCategories()
  console.log(`categories imported: ${categoriesImported}`)

  const { imported, failed } = await importSkills()
  console.log(`skills imported: ${imported}, failed: ${failed}`)

  await consolePool.end()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('[import-console-skills] failed:', error)
  process.exit(1)
})