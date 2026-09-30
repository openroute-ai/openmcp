import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { authors, skills } from '@workspace/db'
import { buildMinimalSkillPackage, buildSkillPackage } from '@/lib/agent-install/skill-package'
import { resolveStoreAuth } from '@/lib/agent-install/store-mcp'
import { db } from '@/lib/db'
import { filesFromSkillRow } from '@/lib/security-scan'
import { createZipStore } from '@/lib/zip/create-zip-store'
import { userHasSkillEntitlement } from '@/web/skills/acquire'
import { getVersionFiles } from '@/web/skills/versions'

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

/**
 * Shared handler for `/api/skills/[id]/package` and `/api/skills/[id]/download`.
 * Requires login (session cookie, Bearer API Key, or OAuth token); paid skills additionally require `skill_entitlements`.
 */
export async function serveSkillPackage(request: Request, idOrSlug: string) {
  try {
    const url = new URL(request.url)
    const format = url.searchParams.get('format')
    const version = url.searchParams.get('version') || undefined

    const resolved = await resolveSkill(idOrSlug)
    if (!resolved) {
      return NextResponse.json({ error: '技能未找到' }, { status: 404 })
    }

    const { userId } = await resolveStoreAuth(request)

    if (!userId) {
      return NextResponse.json({ error: '请先登录（支持 Session / API Key / OAuth）' }, { status: 401 })
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

    if (pkg.files.length === 0) {
      return NextResponse.json({ error: '暂无可打包文件' }, { status: 404 })
    }

    const buffer = createZipStore(pkg.files.map((f) => ({ path: f.path, content: f.content })))
    const suffix = version ? `-${version}` : ''
    return zipResponse(buffer, `${pkg.name.replace(/[^\w.-]+/g, '_')}${suffix}.zip`)
  } catch (error) {
    console.error('[skills/package]', error)
    return NextResponse.json({ error: '打包失败' }, { status: 500 })
  }
}
