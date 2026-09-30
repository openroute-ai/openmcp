import { type NextRequest } from 'next/server'
import { serveSkillPackage } from '@/lib/skills/serve-skill-package'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/skills/[id]/package
 *
 * Streams a store-method ZIP of the skill source files. `id` accepts a skill
 * uuid or slug. `?format=json` returns the file manifest instead of a ZIP, and
 * `?version=x.x.x` pins a specific published version.
 *
 * Every skill requires login (session / Bearer API Key / OAuth token); paid
 * skills additionally require an entitlement.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return serveSkillPackage(request, id)
}
