import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authors, skills } from '@workspace/db'
import { buildSkillPackage, buildMinimalSkillPackage } from '@/lib/agent-install/skill-package'
import { filesFromSkillRow } from '@/lib/security-scan'
import { createZipStore } from '@/lib/zip/create-zip-store'
import { userHasSkillEntitlement } from '@/web/skills/acquire'
import { auth } from '@/lib/auth'
import { getVersionFiles } from '@/web/skills/versions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function resolveSkill(idOrSlug: string) {
  const columns = { skill: skills, author: authors }

  const byId = await db
    .select(columns)
    .from(skills)
    .leftJoin(authors, eq(skills.authorId, authors.id))
    .where(eq(skills.id, idOrSlug))
    .limit(1)
  if (byId.length > 0) return byId[0]

  const bySlug = await db
    .select(columns)
    .from(skills)
    .leftJoin(authors, eq(skills.authorId, authors.id))
    .where(eq(skills.slug, idOrSlug))
    .limit(1)
  if (bySlug.length > 0) return bySlug[0]

  return null
}

/**
 * GET /api/skills/[id]/package
 *
 * Streams a store-method ZIP of the skill source files. `id` accepts a skill
 * uuid or slug. `?format=json` returns the file manifest instead of a ZIP, and
 * `?version=x.x.x` pins a specific published version.
 *
 * Every skill requires a session, and paid skills additionally require an
 * entitlement, so the archive is never handed out to anonymous callers.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const format = request.nextUrl.searchParams.get('format')
    const version = request.nextUrl.searchParams.get('version') || undefined

    const resolved = await resolveSkill(id)
    if (!resolved) {
      return NextResponse.json({ error: '技能未找到' }, { status: 404 })
    }

    const session = await auth.api.getSession({ headers: request.headers })
    const userId = session?.user?.id ?? null

    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }
    if (resolved.skill.status !== 'published') {
      return NextResponse.json({ error: '技能未上架' }, { status: 403 })
    }
    if (resolved.skill.priceType === 'paid') {
      const entitled = await userHasSkillEntitlement(userId, resolved.skill.id)
      if (!entitled) {
        return NextResponse.json({ error: '请先购买' }, { status: 403 })
      }
    }

    const skill = resolved.skill
    const author = resolved.author
    const targetVersion = version || skill.version || '1.0.0'

    // GitHub-sourced skills only ship a metadata package; there are no
    // vendored source files to archive.
    if (skill.sourceType === 'github' && skill.githubUrl) {
      const pkg = buildMinimalSkillPackage({
        id: skill.id,
        slug: skill.slug,
        title: skill.title,
        description: skill.description ?? skill.readme,
        version: targetVersion,
        priceType: skill.priceType === 'paid' ? 'paid' : 'free',
        authorName: author?.name ?? undefined,
        authorId: author?.id ?? undefined,
      })

      if (format === 'json') {
        return NextResponse.json({
          data: { name: pkg.name, files: pkg.files, targetDirs: pkg.targetDirs },
        })
      }

      const buffer = createZipStore(pkg.files.map((f) => ({ path: f.path, content: f.content })))
      return zipResponse(buffer, `${pkg.name.replace(/[^\w.-]+/g, '_')}-meta.zip`)
    }

    let sourceFiles: Array<{ path: string; content: string }> = []
    if (version) {
      const versionFiles = await getVersionFiles({ skillId: skill.id, version })
      if (!versionFiles) {
        return NextResponse.json({ error: '指定的版本不存在或无文件' }, { status: 404 })
      }
      sourceFiles = versionFiles
    } else {
      sourceFiles = await filesFromSkillRow({
        readme: skill.readme,
        readmeEn: skill.readmeEn,
        metadata: skill.metadata,
      })
    }

    const pkg = buildSkillPackage({
      id: skill.id,
      slug: skill.slug,
      title: skill.title,
      description: skill.description ?? null,
      readme: skill.readme,
      readmeEn: skill.readmeEn,
      version: targetVersion,
      priceType: skill.priceType === 'paid' ? 'paid' : 'free',
      authorName: author?.name ?? undefined,
      authorId: author?.id ?? undefined,
      sourceFiles: sourceFiles.map((f) => ({ path: f.path, content: f.content })),
    })

    if (format === 'json') {
      return NextResponse.json({
        data: { name: pkg.name, files: pkg.files, targetDirs: pkg.targetDirs },
      })
    }

    const buffer = createZipStore(pkg.files.map((f) => ({ path: f.path, content: f.content })))
    const suffix = version ? `-${version}` : ''
    return zipResponse(buffer, `${pkg.name}${suffix}.zip`)
  } catch (error) {
    console.error('[skills/package]', error)
    return NextResponse.json({ error: '打包失败' }, { status: 500 })
  }
}

function zipResponse(buffer: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  })
}
