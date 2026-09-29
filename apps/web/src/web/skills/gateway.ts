import { and, desc, eq } from 'drizzle-orm'
import { db } from "@/lib/db"
import { repos, skills } from "@workspace/db"
import { parseGithubRepoUrl } from "@/lib/gateway/names"
import { triggerGithubFetch } from '@/lib/github-nextjs/client'
import { filesFromSkillRow, runSkillSecurityScan } from "@/lib/security-scan"
import { mapSkillRow } from '@/web/assets/map-asset'

function toSlug(referenceId: string): string {
  return referenceId.replace(/\//g, '-').replace(/#/g, '--')
}

export const skillsGatewayAccess = {
  listMine: async (authorId: string) => {
    const rows = await db.select().from(skills).where(eq(skills.authorId, authorId)).orderBy(desc(skills.createdAt))
    return rows.map((row) =>
      mapSkillRow({
        ...row,
        priceAmount: row.priceAmount?.toString() ?? null,
        unitPrice: row.unitPrice?.toString() ?? null,
      })
    )
  },

  getMineById: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.authorId, authorId)))
      .limit(1)
    if (!row) return null
    return mapSkillRow({
      ...row,
      priceAmount: row.priceAmount?.toString() ?? null,
      unitPrice: row.unitPrice?.toString() ?? null,
    })
  },

  checkGithubRepo: async (repoUrl: string) => {
    const parsed = parseGithubRepoUrl(repoUrl)
    if (!parsed) return { ready: false, found: false, message: 'Invalid GitHub URL' }
    const [repo] = await db
      .select({
        id: repos.id,
        owner: repos.owner,
        name: repos.name,
        stars: repos.stars,
        licenseSpdxId: repos.licenseSpdxId,
        homepage: repos.homepage,
        readmeContent: repos.readmeContent,
        readmeContentZh: repos.readmeContentZh,
      })
      .from(repos)
      .where(and(eq(repos.owner, parsed.owner), eq(repos.name, parsed.name)))
      .limit(1)
    if (!repo) return { ready: false, found: false, fullName: parsed.fullName }

    const skillRows = await db
      .select({
        id: skills.id,
        title: skills.title,
        description: skills.description,
        version: skills.version,
        status: skills.status,
        securityGrade: skills.securityGrade,
      })
      .from(skills)
      .where(eq(skills.githubUrl, `https://github.com/${parsed.fullName}`))
      .limit(5)

    const byRef = await db
      .select({
        id: skills.id,
        title: skills.title,
        description: skills.description,
        version: skills.version,
        status: skills.status,
        securityGrade: skills.securityGrade,
      })
      .from(skills)
      .where(eq(skills.referenceId, `${parsed.fullName}#.`))
      .limit(1)

    const skill = skillRows[0] ?? byRef[0] ?? null
    return {
      ready: Boolean(repo.readmeContent || repo.readmeContentZh || skill),
      found: true,
      fullName: parsed.fullName,
      repo,
      skill,
    }
  },

  triggerFetch: (repoUrl: string) => triggerGithubFetch(repoUrl, 'skill'),

  pollSync: async (repoUrl: string) => {
    const check = await skillsGatewayAccess.checkGithubRepo(repoUrl)
    return { ready: check.ready, retryAfter: check.ready ? undefined : 5000, skill: check.skill ?? null }
  },

  connectFromGithub: async (input: {
    authorId: string
    repoUrl: string
    name?: string | null
    description?: string | null
    visibility?: 'public' | 'private' | 'team'
    priceType?: 'free' | 'paid'
    billingModel?: 'one_time' | 'subscription' | 'pay_per_call' | null
    priceAmount?: string | number | null
    unitPrice?: string | number | null
    imageUrl?: string | null
  }) => {
    const parsed = parseGithubRepoUrl(input.repoUrl)
    if (!parsed) throw new Error('Invalid GitHub URL')

    const referenceId = `${parsed.fullName}#.`
    const [existing] = await db.select().from(skills).where(eq(skills.referenceId, referenceId)).limit(1)
    const [byUrl] = existing
      ? [existing]
      : await db
          .select()
          .from(skills)
          .where(eq(skills.githubUrl, `https://github.com/${parsed.fullName}`))
          .limit(1)

    const [repo] = await db
      .select()
      .from(repos)
      .where(and(eq(repos.owner, parsed.owner), eq(repos.name, parsed.name)))
      .limit(1)

    let skillId: string
    if (byUrl) {
      skillId = byUrl.id
      await db
        .update(skills)
        .set({
          authorId: input.authorId,
          sourceType: 'github',
          githubUrl: `https://github.com/${parsed.fullName}`,
          visibility: input.visibility ?? 'public',
          description: input.description ?? byUrl.description,
          title: input.name ?? byUrl.title,
          titleEn: input.name ?? byUrl.titleEn ?? byUrl.title,
          imageUrl: 'imageUrl' in input ? input.imageUrl : byUrl.imageUrl,
          priceType: input.priceType ?? byUrl.priceType,
          billingModel: input.billingModel ?? byUrl.billingModel,
          priceAmount: input.priceAmount != null ? String(input.priceAmount) : byUrl.priceAmount,
          unitPrice: input.unitPrice != null ? String(input.unitPrice) : byUrl.unitPrice,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, skillId))
    } else {
      const now = new Date()
      const { createId } = await import("@workspace/db")
      skillId = createId()
      await db.insert(skills).values({
        id: skillId,
        referenceId,
        slug: toSlug(referenceId),
        title: input.name ?? parsed.name,
        titleEn: input.name ?? parsed.name,
        description: input.description ?? repo?.descriptionZh ?? repo?.description ?? null,
        descriptionEn: repo?.description ?? null,
        readme: repo?.readmeContentZh ?? null,
        readmeEn: repo?.readmeContent ?? null,
        authorId: input.authorId,
        sourceType: 'github',
        githubUrl: `https://github.com/${parsed.fullName}`,
        visibility: input.visibility ?? 'public',
        imageUrl: input.imageUrl ?? null,
        status: 'scanning',
        certified: false,
        priceType: input.priceType ?? 'free',
        billingModel: input.billingModel ?? null,
        priceAmount: input.priceAmount != null ? String(input.priceAmount) : null,
        unitPrice: input.unitPrice != null ? String(input.unitPrice) : null,
        createdAt: now,
        updatedAt: now,
      })
    }

    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1)
    if (!skill) return null
    const files = await filesFromSkillRow(skill)
    if (files.length === 0 && repo?.readmeContent) {
      files.push({ path: 'README.md', content: repo.readmeContent })
    }
    await runSkillSecurityScan({
      skillId,
      files,
      context: {
        owner: parsed.owner,
        homepage: repo?.homepage,
        stars: repo?.stars,
        license: repo?.licenseSpdxId,
      },
    }).catch((error) => {
      console.error('[skills] scan failed', error)
    })

    return skillsGatewayAccess.getMineById(input.authorId, skillId)
  },

  connectFromParsed: async (input: {
    authorId: string
    name: string
    description?: string | null
    version?: string | null
    license?: string | null
    files: Array<{ path: string; content: string }>
    visibility?: 'public' | 'private' | 'team'
    priceType?: 'free' | 'paid'
    billingModel?: 'one_time' | 'subscription' | 'pay_per_call' | null
    priceAmount?: string | number | null
    unitPrice?: string | number | null
    imageUrl?: string | null
  }) => {
    const { createId } = await import("@workspace/db")
    const skillId = createId()
    const referenceId = `zip:${skillId}`
    const now = new Date()
    await db.insert(skills).values({
      id: skillId,
      referenceId,
      slug: toSlug(referenceId),
      title: input.name,
      titleEn: input.name,
      description: input.description ?? null,
      version: input.version ?? null,
      authorId: input.authorId,
      sourceType: 'zip',
      visibility: input.visibility ?? 'public',
      imageUrl: input.imageUrl ?? null,
      status: 'scanning',
      certified: false,
      priceType: input.priceType ?? 'free',
      billingModel: input.billingModel ?? null,
      priceAmount: input.priceAmount != null ? String(input.priceAmount) : null,
      unitPrice: input.unitPrice != null ? String(input.unitPrice) : null,
      metadata: { license: input.license, sourceFiles: input.files },
      createdAt: now,
      updatedAt: now,
    })

    await runSkillSecurityScan({
      skillId,
      files: input.files,
      context: {},
    })

    return skillsGatewayAccess.getMineById(input.authorId, skillId)
  },

  rescan: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.authorId, authorId)))
      .limit(1)
    if (!row) throw new Error('Skill 不存在')
    const files = await filesFromSkillRow(row)
    return runSkillSecurityScan({ skillId: id, files, context: {} })
  },

  publish: async (
    authorId: string,
    id: string,
    extra?: {
      description?: string | null
      visibility?: 'public' | 'private' | 'team'
      priceType?: 'free' | 'paid'
      billingModel?: 'one_time' | 'subscription' | 'pay_per_call' | null
      priceAmount?: string | number | null
      unitPrice?: string | number | null
      imageUrl?: string | null
    }
  ) => {
    const [row] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.authorId, authorId)))
      .limit(1)
    if (!row) throw new Error('Skill 不存在')
    if (row.securityGrade !== 'safe' && row.securityGrade !== 'caution') {
      throw new Error('仅 safe/caution 评级可提交上架')
    }
    const updates = extra ?? {}
    await db
      .update(skills)
      .set({
        status: 'published',
        publishedAt: row.publishedAt ?? new Date(),
        description: updates.description ?? row.description,
        visibility: updates.visibility ?? row.visibility,
        imageUrl: 'imageUrl' in updates ? updates.imageUrl : row.imageUrl,
        priceType: updates.priceType ?? row.priceType,
        billingModel: updates.billingModel ?? row.billingModel,
        priceAmount: updates.priceAmount != null ? String(updates.priceAmount) : row.priceAmount,
        unitPrice: updates.unitPrice != null ? String(updates.unitPrice) : row.unitPrice,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, id))
    return skillsGatewayAccess.getMineById(authorId, id)
  },

  toggle: async (authorId: string, id: string, enabled: boolean) => {
    const [row] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.authorId, authorId)))
      .limit(1)
    if (!row) throw new Error('Skill 不存在')
    await db
      .update(skills)
      .set({ status: enabled ? 'published' : 'archived', updatedAt: new Date() })
      .where(eq(skills.id, id))
    return skillsGatewayAccess.getMineById(authorId, id)
  },

  remove: async (authorId: string, id: string) => {
    const [row] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.authorId, authorId)))
      .limit(1)
    if (!row) throw new Error('Skill 不存在')
    await db.delete(skills).where(eq(skills.id, id))
    return { ok: true }
  },
}
