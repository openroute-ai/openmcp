/**
 * Client-facing shapes for the ranking pages.
 *
 * The UI reads these off tRPC output; they are declared separately so the card
 * and the pages can type their props without importing tRPC's inferred types
 * (which do not survive the `success` envelope well).
 */

export type RankingWorkflowRow = {
  id: string
  rank: number
  rankChange: number | null
  trend: 'up' | 'down' | 'stable' | 'new' | null
  popularityScore: string
  recentViews: number
  recentDownloads: number
  recentLikes: number
  recentComments: number
  recentVerifications: number
  popularViews: number
  popularDownloads: number
  popularLikes: number
  popularComments: number
  popularVerifications: number
  workflow: {
    id: string
    referenceId: string
    slug: string
    title: string
    description: string | null
    descriptionEn: string | null
    summary: string | null
    imageUrl: string | null
    priceType: 'free' | 'paid'
    complexity: 'beginner' | 'intermediate' | 'advanced' | null
    certified: boolean
    views: number
    downloads: number
    likes: number
    publishedAt: Date | null
  }
  author: {
    id: string
    name: string
    username: string
    avatar: string | null
    verified: boolean
  }
}
