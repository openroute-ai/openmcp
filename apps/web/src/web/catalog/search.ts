/**
 * Unified structured catalog search over published Skills / MCP / A2A / Apps(workflows).
 *
 * Ranking (default sort=hot) — same formula as `catalog_assets.hotScore` view:
 *   hot_score = ln(1 + downloads) * 2.0
 *             + GREATEST(0, 30 - age_days) * 0.35
 *             + security_weight (safe=8, caution=3, unknown=1, else=0)
 *             + (certified ? 5 : 0)
 *             + (app) popularity * 0.01
 *
 * Search is SQL/ILIKE + tags containment (Chinese-friendly). No Elasticsearch.
 */
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { catalogAssets, categories } from '@workspace/db'
import { db } from '@/lib/db'
import { buildAssetDetailUrl } from '@/lib/agent-install/urls'
import type {
  CatalogAsset,
  CatalogKind,
  CatalogSearchInput,
  CatalogSecurityGrade,
} from './types'

const SECURITY_RANK: Record<string, number> = {
  safe: 4,
  caution: 3,
  unknown: 2,
  unsafe: 1,
  reject: 0,
}

function clampLimit(n: number | undefined, fallback = 20): number {
  if (!Number.isFinite(n as number)) return fallback
  return Math.max(1, Math.min(50, Math.floor(n as number)))
}

function normalizeKinds(kind?: CatalogKind | CatalogKind[]): CatalogKind[] | null {
  if (!kind) return null
  const list = Array.isArray(kind) ? kind : [kind]
  const allowed: CatalogKind[] = ['skill', 'mcp', 'a2a', 'app']
  const filtered = list.filter((k): k is CatalogKind => allowed.includes(k))
  return filtered.length ? filtered : null
}

function normalizeTags(tags?: string[]): string[] {
  if (!tags?.length) return []
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 20)
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(String).filter(Boolean)
}

function detailUrl(kind: CatalogKind, slug: string): string {
  if (kind === 'app') {
    // workflows are marketed as apps locally
    return `/workflows/${slug}`
  }
  return buildAssetDetailUrl(kind, slug)
}

function meetsMinSecurity(grade: string | null, min?: CatalogSecurityGrade): boolean {
  if (!min) return true
  const g = (grade ?? 'unknown').toLowerCase()
  const got = SECURITY_RANK[g] ?? 0
  const need = SECURITY_RANK[min] ?? 0
  return got >= need
}

async function resolveCategoryId(input: CatalogSearchInput): Promise<string | null> {
  if (input.categoryId) return input.categoryId
  if (!input.categorySlug) return null
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, input.categorySlug))
    .limit(1)
  return row?.id ?? null
}

export async function searchCatalog(
  input: CatalogSearchInput = {}
): Promise<{ assets: CatalogAsset[]; total: number }> {
  const limit = clampLimit(input.limit)
  const offset = Math.max(0, Math.floor(input.offset ?? 0))
  const kinds = normalizeKinds(input.kind)
  const tags = normalizeTags(input.tags)
  const q = input.q?.trim() ?? ''
  const categoryId = await resolveCategoryId(input)

  const conditions: SQL[] = []

  if (kinds) {
    conditions.push(inArray(catalogAssets.kind, kinds))
  }
  if (categoryId) {
    conditions.push(eq(catalogAssets.categoryId, categoryId))
  }
  if (input.priceType) {
    conditions.push(eq(catalogAssets.priceType, input.priceType))
  }
  if (typeof input.certified === 'boolean') {
    conditions.push(eq(catalogAssets.certified, input.certified))
  }
  if (q) {
    const pattern = `%${q}%`
    conditions.push(
      or(
        ilike(catalogAssets.title, pattern),
        ilike(catalogAssets.slug, pattern),
        ilike(catalogAssets.description, pattern)
      )!
    )
  }
  if (tags.length) {
    // tags @> '["a","b"]'::jsonb — asset must contain all requested tags
    conditions.push(sql`${catalogAssets.tags} @> ${JSON.stringify(tags)}::jsonb`)
  }

  const where = conditions.length ? and(...conditions) : undefined

  const orderBy =
    input.sort === 'downloads'
      ? [desc(catalogAssets.downloads), desc(catalogAssets.hotScore)]
      : input.sort === 'recent'
        ? [desc(catalogAssets.publishedAt), desc(catalogAssets.hotScore)]
        : [desc(catalogAssets.hotScore), desc(catalogAssets.downloads)]

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(catalogAssets)
    .where(where)

  let rows = await db
    .select()
    .from(catalogAssets)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit * 2) // over-fetch slightly for securityGrade post-filter
    .offset(offset)

  if (input.securityGrade) {
    rows = rows.filter((r) => meetsMinSecurity(r.securityGrade, input.securityGrade))
  }

  const assets: CatalogAsset[] = rows.slice(0, limit).map((r) => ({
    kind: r.kind as CatalogKind,
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    categoryId: r.categoryId,
    priceType: r.priceType,
    securityGrade: r.securityGrade,
    certified: r.certified,
    downloads: r.downloads,
    views: r.views,
    publishedAt: r.publishedAt,
    tags: parseTags(r.tags),
    hotScore: Number(r.hotScore) || 0,
    detailUrl: detailUrl(r.kind as CatalogKind, r.slug),
  }))

  return { assets, total: Number(countRow?.total ?? assets.length) }
}

/** Browse top hot assets (empty q). Useful for homepage / recommend fallback. */
export async function listHotCatalog(limit = 10, kind?: CatalogKind | CatalogKind[]) {
  return searchCatalog({ kind, sort: 'hot', limit })
}
