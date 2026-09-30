export type CatalogKind = 'skill' | 'mcp' | 'a2a' | 'app'

export type CatalogSecurityGrade = 'safe' | 'caution' | 'unsafe' | 'reject' | 'unknown'

export type CatalogSearchInput = {
  /** Free-text query (title / slug / description). Empty = browse by filters + ranking. */
  q?: string
  /** Single kind or list. Omit = all kinds. */
  kind?: CatalogKind | CatalogKind[]
  /** Category slug (resolved via categories table). */
  categorySlug?: string
  /** Category id (preferred when known). */
  categoryId?: string
  tags?: string[]
  priceType?: 'free' | 'paid'
  /** Minimum acceptable security grade (safe > caution > unknown > unsafe/reject). */
  securityGrade?: CatalogSecurityGrade
  certified?: boolean
  /** Default: hot (hot_score). */
  sort?: 'hot' | 'downloads' | 'recent'
  limit?: number
  offset?: number
}

export type CatalogAsset = {
  kind: CatalogKind
  id: string
  slug: string
  title: string
  description: string | null
  categoryId: string | null
  priceType: string
  securityGrade: string | null
  certified: boolean
  downloads: number
  views: number
  publishedAt: Date | null
  tags: string[]
  hotScore: number
  detailUrl: string
}

export type CatalogRecommendInput = {
  /** 选型场景 / 需求描述（中文友好），用作搜索词 */
  useCase: string
  kind?: CatalogKind | CatalogKind[]
  priceType?: 'free' | 'paid'
  /** Prefer free when ranking ties / soft boost */
  preferFree?: boolean
  securityGrade?: CatalogSecurityGrade
  tags?: string[]
  limit?: number
}

export type CatalogRecommendation = CatalogAsset & {
  reason: string
}
