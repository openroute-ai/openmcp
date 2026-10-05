import { and, count, desc, eq, ilike, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { repos, skills } from "@workspace/db"
import { parseGithubRepoUrl } from "@/lib/gateway/names"
import {
  ConsoleTimeoutError,
  consoleApiConfigured,
  consoleFoundNoSkills,
  consoleSubmitMode,
  submitRepo,
} from "@/lib/console/client"
import { filesFromSkillRow, runSkillSecurityScan } from "@/lib/security-scan"
import { mapSkillRow } from "@/web/assets/map-asset"
import type { MineListOptions } from "@/web/assets/mine-list"

function toSlug(referenceId: string): string {
  return referenceId.replace(/\//g, "-").replace(/#/g, "--")
}

export const skillsGatewayAccess = {
  /** 名下资产：服务端搜索 + 分页，理由同 MCP 的 `listMine`。 */
  listMine: async (authorId: string, opts: MineListOptions = {}) => {
    const { search, status, page = 1, pageSize = 20 } = opts
    const where = [eq(skills.authorId, authorId)]
    // status 在表上是枚举列，入参是 string：按该列自身的枚举收窄，避免塞进库外的值
    if (status)
      where.push(
        eq(skills.status, status as (typeof skills.status.enumValues)[number])
      )
    if (search) {
      const needle = `%${search}%`
      where.push(
        or(
          ilike(skills.title, needle),
          ilike(skills.slug, needle),
          ilike(skills.description, needle)
        )!
      )
    }
    const whereExpr = and(...where)

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(skills)
        .where(whereExpr)
        .orderBy(desc(skills.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: count() }).from(skills).where(whereExpr),
    ])

    const total = totalRow?.n ?? 0
    return {
      items: rows.map((row) =>
        mapSkillRow({
          ...row,
          priceAmount: row.priceAmount?.toString() ?? null,
          unitPrice: row.unitPrice?.toString() ?? null,
        })
      ),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
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
    if (!parsed)
      return { ready: false, found: false, message: "Invalid GitHub URL" }
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
      // A skill row is enough on its own. console pushes the skill document
      // without this app ever writing a local `repos` row, so requiring one
      // would leave every repository registered from the web app unready until
      // the crawler happened to see it too.
      ready: Boolean(repo?.readmeContent || repo?.readmeContentZh || skill),
      found: Boolean(repo || skill),
      fullName: parsed.fullName,
      repo: repo ?? null,
      skill,
    }
  },

  /**
   * Hand a repository to console so its sync tasks own it.
   *
   * Which endpoint that is depends on `CONSOLE_SKILLS_REGISTER_ONLY` (see
   * {@link submitRepo}): either console curates it into a published project and
   * pushes the skill document back, or it only records the repository against
   * this app's submitter account and does nothing else. `mode` in the answer is
   * what the caller needs to tell those apart - in register mode no skill is ever
   * coming, so polling for one can only time out.
   *
   * `pending` is the same question for publish mode, and it exists because
   * `delivered` cannot answer it: console reports `delivered: true` for a
   * repository whose configured skill path holds no `SKILL.md` at all, because
   * "every stored skill arrived" is vacuously true when there were none. Told to
   * wait in that case, the caller spends a whole polling budget on a push that is
   * not coming — and the user is told to retry something that cannot change.
   *
   * This is an ingest, not a fetch. console has the GitHub credentials; this
   * app only has the repositories its own collector already recorded, and
   * console's ingest is upsert-only over the columns it accepts, so pushing
   * what we hold is safe and idempotent. console then picks the repository up
   * for its own stats sweep, ranking and skill-document sync, and pushes the
   * skill back through the webhook this app already ingests.
   *
   * An unindexed repository cannot be registered this way - there is no data
   * to send and console has no bare-URL endpoint - so it is reported as
   * unready rather than left to time out in the caller's polling loop.
   */
  registerWithConsole: async (
    repoUrl: string
  ): Promise<{
    ready: boolean
    registered: boolean
    pending: boolean
    mode: "publish" | "register"
    message: string
  }> => {
    const parsed = parseGithubRepoUrl(repoUrl)
    if (!parsed)
      return {
        ready: false,
        registered: false,
        pending: false,
        mode: "publish",
        message: "Invalid GitHub URL",
      }

    // console is the only side with GitHub credentials and the only writer of
    // the repository/project/skill tables, so with it unconfigured there is
    // nothing this app can do except report what the crawler already stored.
    if (!consoleApiConfigured()) {
      const check = await skillsGatewayAccess.checkGithubRepo(repoUrl)
      return {
        ready: check.ready,
        registered: false,
        pending: false,
        mode: "publish",
        message: check.ready
          ? `${parsed.fullName} 已就绪`
          : `仓库 ${parsed.fullName} 尚未被索引，请稍后重试或改用 ZIP 上传`,
      }
    }

    try {
      // console fetches, creates the project, syncs the skill documents and
      // pushes them back to this app before it answers, so a ready check right
      // afterwards sees the skill rather than an empty poll window.
      const submitted = await submitRepo(repoUrl, "skill")
      const check = await skillsGatewayAccess.checkGithubRepo(repoUrl)

      if (submitted.mode === "register") {
        // Nothing was published and no skill document is coming, so readiness is
        // exactly what the local crawler already knows - there is no pending
        // delivery that could still make it true a second later. Saying so is
        // what stops the caller from spending its poll budget on a push that is
        // not scheduled.
        return {
          ready: check.ready,
          registered: true,
          pending: false,
          mode: "register",
          message: check.ready
            ? `${parsed.fullName} 已就绪（仅登记到 console，未发布项目）`
            : `${parsed.fullName} 已登记到 console，未发布项目`,
        }
      }

      // console read the repository and found no skill document. Re-submitting
      // changes nothing — the path it reads is fixed per project — so the honest
      // answer is "there is nothing to ingest", naming the way out, rather than a
      // "retry in a moment" that retries into the same empty result.
      if (!check.ready && consoleFoundNoSkills(submitted)) {
        return {
          ready: false,
          registered: true,
          pending: false,
          mode: "publish",
          message: `仓库 ${parsed.fullName} 中未找到 SKILL.md，无法入库技能；请确认技能文档路径，或改用 ZIP 上传`,
        }
      }

      return {
        ready: check.ready,
        registered: true,
        // Not ready with skills on the way is the one case that can still turn
        // true on its own, so it is the only one the caller may poll for.
        pending: !check.ready && submitted.delivered === true,
        mode: "publish",
        message: check.ready
          ? `${parsed.fullName} 已就绪`
          : submitted.delivered
            ? `仓库 ${parsed.fullName} 已登记，技能正在入库，请稍后重试`
            : `仓库 ${parsed.fullName} 已登记，但技能推送未完成，请稍后重试`,
      }
    } catch (error) {
      // This app ran out of patience, not console. A repository with a dozen
      // skills spends most of that time translating them, and console finishes
      // and pushes regardless of whether anyone is still on the line — so this is
      // the one console error that means "keep waiting" instead of "it failed".
      // Reporting it as a failure told the user their submission was lost while
      // console was still working on it.
      if (error instanceof ConsoleTimeoutError) {
        return {
          ready: false,
          registered: false,
          // Pending, because console's push is what makes a later poll succeed.
          // The skill documents are still on their way.
          pending: true,
          mode: consoleSubmitMode(),
          message: `console 仍在处理 ${parsed.fullName}，技能尚未入库，请稍后重试`,
        }
      }

      // A console outage must not block a creator: if the crawler already
      // indexed the repository, the listing can still be created from it.
      console.error("[skills] console ingest failed", parsed.fullName, error)
      const check = await skillsGatewayAccess.checkGithubRepo(repoUrl)
      return {
        ready: check.ready,
        registered: false,
        // The submission threw, so there is no answer to read a mode off; report
        // the one this deployment is configured for rather than defaulting to
        // publish and telling a register-only caller the wrong thing.
        pending: false,
        mode: consoleSubmitMode(),
        message: check.ready
          ? `${parsed.fullName} 已就绪（console 同步失败，稍后重试）`
          : `仓库 ${parsed.fullName} 登记失败：${error instanceof Error ? error.message : "未知错误"}`,
      }
    }
  },

  pollSync: async (repoUrl: string) => {
    const check = await skillsGatewayAccess.checkGithubRepo(repoUrl)
    return {
      ready: check.ready,
      retryAfter: check.ready ? undefined : 5000,
      skill: check.skill ?? null,
    }
  },

  connectFromGithub: async (input: {
    authorId: string
    repoUrl: string
    name?: string | null
    description?: string | null
    visibility?: "public" | "private" | "team"
    priceType?: "free" | "paid"
    billingModel?: "one_time" | "subscription" | "pay_per_call" | null
    priceAmount?: string | number | null
    unitPrice?: string | number | null
    imageUrl?: string | null
  }) => {
    const parsed = parseGithubRepoUrl(input.repoUrl)
    if (!parsed) throw new Error("Invalid GitHub URL")

    const referenceId = `${parsed.fullName}#.`
    const [existing] = await db
      .select()
      .from(skills)
      .where(eq(skills.referenceId, referenceId))
      .limit(1)
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
          sourceType: "github",
          githubUrl: `https://github.com/${parsed.fullName}`,
          visibility: input.visibility ?? "public",
          description: input.description ?? byUrl.description,
          title: input.name ?? byUrl.title,
          titleEn: input.name ?? byUrl.titleEn ?? byUrl.title,
          imageUrl: "imageUrl" in input ? input.imageUrl : byUrl.imageUrl,
          priceType: input.priceType ?? byUrl.priceType,
          billingModel: input.billingModel ?? byUrl.billingModel,
          priceAmount:
            input.priceAmount != null
              ? String(input.priceAmount)
              : byUrl.priceAmount,
          unitPrice:
            input.unitPrice != null ? String(input.unitPrice) : byUrl.unitPrice,
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
        description:
          input.description ?? repo?.descriptionZh ?? repo?.description ?? null,
        descriptionEn: repo?.description ?? null,
        readme: repo?.readmeContentZh ?? null,
        readmeEn: repo?.readmeContent ?? null,
        authorId: input.authorId,
        sourceType: "github",
        githubUrl: `https://github.com/${parsed.fullName}`,
        visibility: input.visibility ?? "public",
        imageUrl: input.imageUrl ?? null,
        status: "scanning",
        certified: false,
        priceType: input.priceType ?? "free",
        billingModel: input.billingModel ?? null,
        priceAmount:
          input.priceAmount != null ? String(input.priceAmount) : null,
        unitPrice: input.unitPrice != null ? String(input.unitPrice) : null,
        createdAt: now,
        updatedAt: now,
      })
    }

    const [skill] = await db
      .select()
      .from(skills)
      .where(eq(skills.id, skillId))
      .limit(1)
    if (!skill) return null
    const files = await filesFromSkillRow(skill)
    if (files.length === 0 && repo?.readmeContent) {
      files.push({ path: "README.md", content: repo.readmeContent })
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
      console.error("[skills] scan failed", error)
    })

    // Register the repository with console once the listing exists, so the
    // upstream sync domain starts tracking it and pushes updated skill
    // documents back through the webhook. Best effort by design: the listing
    // is already written, and a console outage must not roll back a creator's
    // submission. The web app holds no GitHub credentials, so the repository
    // goes over as a URL and console does the fetch itself.
    //
    // In register-only mode this only records the repository. That is still
    // worth doing here: console's scheduler owns stats and ranking either way,
    // and this is the one call that runs for listings created outside the
    // submit dialog.
    if (consoleApiConfigured()) {
      void submitRepo(input.repoUrl, "skill").catch((error: unknown) => {
        console.error("[skills] console ingest failed", parsed.fullName, error)
      })
    }

    return skillsGatewayAccess.getMineById(input.authorId, skillId)
  },

  connectFromParsed: async (input: {
    authorId: string
    name: string
    description?: string | null
    version?: string | null
    license?: string | null
    files: Array<{ path: string; content: string }>
    visibility?: "public" | "private" | "team"
    priceType?: "free" | "paid"
    billingModel?: "one_time" | "subscription" | "pay_per_call" | null
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
      sourceType: "zip",
      visibility: input.visibility ?? "public",
      imageUrl: input.imageUrl ?? null,
      status: "scanning",
      certified: false,
      priceType: input.priceType ?? "free",
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
    if (!row) throw new Error("Skill 不存在")
    const files = await filesFromSkillRow(row)
    return runSkillSecurityScan({ skillId: id, files, context: {} })
  },

  publish: async (
    authorId: string,
    id: string,
    extra?: {
      description?: string | null
      visibility?: "public" | "private" | "team"
      priceType?: "free" | "paid"
      billingModel?: "one_time" | "subscription" | "pay_per_call" | null
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
    if (!row) throw new Error("Skill 不存在")
    if (row.securityGrade !== "safe" && row.securityGrade !== "caution") {
      throw new Error("仅 safe/caution 评级可提交上架")
    }
    const updates = extra ?? {}
    await db
      .update(skills)
      .set({
        status: "published",
        publishedAt: row.publishedAt ?? new Date(),
        description: updates.description ?? row.description,
        visibility: updates.visibility ?? row.visibility,
        imageUrl: "imageUrl" in updates ? updates.imageUrl : row.imageUrl,
        priceType: updates.priceType ?? row.priceType,
        billingModel: updates.billingModel ?? row.billingModel,
        priceAmount:
          updates.priceAmount != null
            ? String(updates.priceAmount)
            : row.priceAmount,
        unitPrice:
          updates.unitPrice != null ? String(updates.unitPrice) : row.unitPrice,
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
    if (!row) throw new Error("Skill 不存在")
    await db
      .update(skills)
      .set({
        status: enabled ? "published" : "archived",
        updatedAt: new Date(),
      })
      .where(eq(skills.id, id))
    return skillsGatewayAccess.getMineById(authorId, id)
  },

  remove: async (authorId: string, id: string) => {
    const [row] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.authorId, authorId)))
      .limit(1)
    if (!row) throw new Error("Skill 不存在")
    await db.delete(skills).where(eq(skills.id, id))
    return { ok: true }
  },
}
