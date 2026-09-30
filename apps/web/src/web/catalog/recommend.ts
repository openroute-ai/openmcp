/**
 * Chat / AI 选型推荐：基于 structured catalog search + hot ranking。
 * 供 Store MCP `recommend_assets` 与 tRPC `catalog.recommend` 共用。
 */
import { searchCatalog } from './search'
import type { CatalogAsset, CatalogRecommendInput, CatalogRecommendation } from './types'

function clampLimit(n: number | undefined, fallback = 5): number {
  if (!Number.isFinite(n as number)) return fallback
  return Math.max(1, Math.min(20, Math.floor(n as number)))
}

function buildReason(asset: CatalogAsset): string {
  const kindLabel =
    asset.kind === 'skill'
      ? 'Skill'
      : asset.kind === 'mcp'
        ? 'MCP'
        : asset.kind === 'a2a'
          ? 'A2A'
          : 'App'
  const parts: string[] = [`匹配「${kindLabel}」候选「${asset.title}」`]
  if (asset.certified) parts.push('平台认证')
  if (asset.securityGrade === 'safe') parts.push('安全评级 safe')
  else if (asset.securityGrade === 'caution') parts.push('安全评级 caution')
  if (asset.priceType === 'free') parts.push('免费可用')
  if (asset.downloads > 0) parts.push(`下载 ${asset.downloads}`)
  if (asset.tags.length) parts.push(`标签 ${asset.tags.slice(0, 3).join('/')}`)
  parts.push(`热度分 ${asset.hotScore.toFixed(1)}`)
  return parts.join('；')
}

/**
 * Recommend marketplace assets for a chat / AI 选型 use case.
 * Soft-prefers free + safe when preferFree is true (default) and priceType unset.
 */
export async function recommendCatalogAssets(
  input: CatalogRecommendInput
): Promise<{ recommendations: CatalogRecommendation[]; query: string }> {
  const useCase = input.useCase?.trim()
  if (!useCase) {
    return { recommendations: [], query: '' }
  }

  const limit = clampLimit(input.limit)
  const preferFree = input.preferFree !== false && !input.priceType

  const { assets } = await searchCatalog({
    q: useCase,
    kind: input.kind,
    priceType: input.priceType,
    securityGrade: input.securityGrade ?? 'caution',
    tags: input.tags,
    sort: 'hot',
    limit: Math.min(50, limit * 3),
  })

  let ranked = [...assets]
  if (preferFree) {
    ranked.sort((a, b) => {
      const boost = (x: CatalogAsset) =>
        (x.priceType === 'free' ? 3 : 0) +
        (x.securityGrade === 'safe' ? 2 : x.securityGrade === 'caution' ? 1 : 0)
      return b.hotScore + boost(b) - (a.hotScore + boost(a))
    })
  }

  // Fallback: if text query matches nothing, return hot list under same filters
  if (ranked.length === 0) {
    const fallback = await searchCatalog({
      kind: input.kind,
      priceType: input.priceType,
      securityGrade: input.securityGrade ?? 'caution',
      tags: input.tags,
      sort: 'hot',
      limit,
    })
    ranked = fallback.assets
  }

  const recommendations: CatalogRecommendation[] = ranked.slice(0, limit).map((a) => ({
    ...a,
    reason: buildReason(a),
  }))

  return { recommendations, query: useCase }
}
