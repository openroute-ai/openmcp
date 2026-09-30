import { type NextRequest } from 'next/server'
import { serveSkillPackage } from '@/lib/skills/serve-skill-package'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/skills/[id]/download
 *
 * Alias of `/package` with the same login + entitlement gate. Kept for acquire
 * delivery URLs and older UI links that point at `/download`.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return serveSkillPackage(request, id)
}
