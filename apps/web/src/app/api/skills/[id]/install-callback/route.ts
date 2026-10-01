import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { skillInstalls, skills } from '@workspace/db'
import { resolveStoreAuth } from '@/lib/agent-install/store-mcp/auth'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

const VALID_RUNTIMES = ['cursor', 'claude-code', 'codex', 'generic'] as const
type InstallRuntime = (typeof VALID_RUNTIMES)[number]

function isInstallRuntime(value: unknown): value is InstallRuntime {
  return typeof value === 'string' && (VALID_RUNTIMES as readonly string[]).includes(value)
}

/**
 * Skill install callback.
 *
 * POST /api/skills/[id]/install-callback
 *
 * Called by the agent (or a user) after a Skill was installed locally, so the
 * install can be recorded in `skill_installs`. The URL is handed out by
 * `lib/agent-install/store-mcp/tools.ts` as `installCallbackUrl` — the Agent
 * side is not optional, so this route must exist whenever that tool is enabled.
 *
 * Auth: session cookie, or a Store MCP `Authorization: Bearer` token
 * (OAuth opaque token / API key).
 *
 * Body: `{ runtime, installPath?, skillVersion? }`
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: skillIdOrSlug } = await params

    // Session first, then the Store MCP bearer credentials.
    let userId: string | null = null

    const session = await auth.api.getSession({ headers: request.headers })
    if (session?.user) {
      userId = session.user.id
    }

    if (!userId) {
      const storeAuth = await resolveStoreAuth(request)
      if (storeAuth.userId) userId = storeAuth.userId
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 })
    }

    const { runtime, installPath, skillVersion } = await request.json()

    if (!isInstallRuntime(runtime)) {
      return NextResponse.json({ success: false, error: 'Invalid runtime' }, { status: 400 })
    }

    // Accept either the primary key or the slug; the callback URL carries a slug.
    const [byId] = await db.select().from(skills).where(eq(skills.id, skillIdOrSlug)).limit(1)
    const skill = byId ?? (await db.select().from(skills).where(eq(skills.slug, skillIdOrSlug)).limit(1))[0]

    if (!skill) {
      return NextResponse.json({ success: false, error: 'Skill not found' }, { status: 404 })
    }

    const now = new Date()

    const [existing] = await db
      .select()
      .from(skillInstalls)
      .where(
        and(
          eq(skillInstalls.userId, userId),
          eq(skillInstalls.skillId, skill.id),
          eq(skillInstalls.runtime, runtime)
        )
      )
      .limit(1)

    if (existing) {
      // Re-installing the same skill into the same runtime: refresh in place
      // rather than adding a duplicate row.
      await db
        .update(skillInstalls)
        .set({
          status: 'active',
          installPath: installPath || existing.installPath,
          skillVersion: skillVersion || skill.version || existing.skillVersion,
          lastUsedAt: now,
          updatedAt: now,
        })
        .where(eq(skillInstalls.id, existing.id))

      return NextResponse.json({
        success: true,
        installId: existing.id,
        message: 'Install record updated',
      })
    }

    // `id` is filled by the table's `$defaultFn`.
    const [inserted] = await db
      .insert(skillInstalls)
      .values({
        skillId: skill.id,
        userId,
        runtime,
        installPath: installPath || null,
        status: 'active',
        installedAt: now,
        lastUsedAt: now,
        skillVersion: skillVersion || skill.version || null,
        skillTitle: skill.title,
        skillSlug: skill.slug,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: skillInstalls.id })

    return NextResponse.json({
      success: true,
      installId: inserted?.id,
      message: 'Install recorded',
    })
  } catch (error) {
    console.error('[install-callback] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
