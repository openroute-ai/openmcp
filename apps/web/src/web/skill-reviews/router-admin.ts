import { and, count, desc, eq, gte, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm'
import z from 'zod'
import { db } from '@/lib/db'
import { authors, providerProfiles, skillReviews, skills, user } from '@workspace/db'
import { filesFromSkillRow, runSkillSecurityScan } from '@/lib/security-scan/run-scan'
import { computeAndPersistEvalReport } from '@/lib/skills/eval-report-persist'
import { notifyUser } from '@/lib/notifications'
import { adminProcedure, createTRPCRouter, superAdminProcedure } from '@/server/routers/trpc'

/**
 * Security review console for submitted skills.
 *
 * A skill moves through this queue on two triggers: the author submits it
 * (`skills.status = 'pending_review'`) or the automatic scanner auto-rejects it
 * (`skill_reviews.review_type = 'auto_reject'`). A human decision updates both
 * the skill and its review row, and the skill's `eval_report` is recomputed so
 * the storefront reflects the new grade.
 *
 * The source app's `getById` accepted either a review id or a skill id, which
 * made the detail route ambiguous. Here the two are separate procedures
 * (`getById` / `getBySkillId`) and each detail page links the other, so a URL
 * always means one thing.
 */

const reviewSelect = {
  id: skillReviews.id,
  skillId: skills.id,
  reviewType: skillReviews.reviewType,
  reviewerId: skillReviews.reviewerId,
  reviewerName: user.name,
  decision: skillReviews.decision,
  reviewComment: skillReviews.reviewComment,
  flaggedFlags: skillReviews.flaggedFlags,
  scanRulesVersion: skillReviews.scanRulesVersion,
  scanGrade: skillReviews.scanGrade,
  llmGrade: skillReviews.llmGrade,
  durationMinutes: skillReviews.durationMinutes,
  createdAt: skillReviews.createdAt,
  title: skills.title,
  slug: skills.slug,
  sourceType: skills.sourceType,
  githubUrl: skills.githubUrl,
  securityGrade: skills.securityGrade,
  securityLlmGrade: skills.securityLlmGrade,
  securityFlags: skills.securityFlags,
  securityLlmAnalysis: skills.securityLlmAnalysis,
  trustTier: skills.trustTier,
  scannedAt: skills.scannedAt,
  reviewStatus: skills.reviewStatus,
  authorId: skills.authorId,
  authorName: authors.name,
  authorUsername: authors.username,
  authorAvatar: authors.avatar,
  /**
   * 最近一次扫描的文件数。
   *
   * 原来这里 `leftJoin(skillScans)` 再在 JS 里按 skillId 去重取最新——join 会
   * 为每次扫描各出一行，于是一个被扫过 5 次的 skill 就吃掉 5 行预算，
   * 队列超过阈值后剩下的条目被静默丢弃。改成相关子查询直接取最新一条，
   * 行数回到「一个 skill 一行」，分页才能在 SQL 里精确切。
   */
  fileCount: sql<number | null>`(
    select s.file_count from skill_scans s
    where s.skill_id = ${skills.id}
    order by s.created_at desc limit 1
  )`,
} as const

type ReviewRow = {
  id: string
  skillId: string
  reviewType: 'auto_reject' | 'manual'
  reviewerId: string | null
  reviewerName: string | null
  decision: 'pass' | 'reject' | 'needs_revision' | null
  reviewComment: string | null
  flaggedFlags: unknown
  scanRulesVersion: string | null
  scanGrade: string | null
  llmGrade: string | null
  durationMinutes: number | null
  createdAt: Date
  title: string
  slug: string
  sourceType: 'github' | 'zip' | null
  githubUrl: string | null
  securityGrade: string | null
  securityLlmGrade: string | null
  securityFlags: unknown
  securityLlmAnalysis: unknown
  trustTier: number | null
  scannedAt: Date | null
  reviewStatus: string | null
  authorId: string
  authorName: string
  authorUsername: string
  authorAvatar: string | null
  fileCount: number | null
}

/**
 * Flatten a review row into the shape the queue tables render, and compute how
 * long the item has been waiting. Waiting time is measured from the scan (or
 * submission) rather than from the review row, because an auto-reject row is
 * created by the scan itself and would otherwise read as "0 minutes".
 */
function toReviewRecord(row: ReviewRow) {
  const submittedAt = row.scannedAt ?? row.createdAt
  const now = Date.now()
  return {
    ...row,
    flags: row.flaggedFlags,
    analysis: row.securityLlmAnalysis,
    fileCount: row.fileCount ?? 0,
    submittedAt,
    waitingMinutes: Math.max(0, Math.round((now - submittedAt.getTime()) / 60_000)),
  }
}

/**
 * 分页入参。
 *
 * 之前这三个列表是「join 出 N 行 → JS 去重 → slice(0, 200)」：第 201 条之后的
 * 条目既不报错也不提示，直接消失。审核队列在积压时恰好是最需要看到"还有多少"
 * 的时候，所以这里改成真分页，并把 `total` 一并返回。
 */
const pageSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
})

const queueSchema = z
  .object({
    source: z.enum(['all', 'github', 'zip']).default('all'),
    trustTier: z.number().int().min(1).max(5).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .merge(pageSchema)
  .optional()

const historySchema = z
  .object({
    decision: z.enum(['all', 'pass', 'reject', 'needs_revision']).default('all'),
    search: z.string().trim().max(100).optional(),
  })
  .merge(pageSchema)
  .optional()

/** Tell the owning provider account about a decision, if there is one. */
async function notifyProvider(skillAuthorId: string, title: string, body: string, skillId: string) {
  const [profile] = await db
    .select({ userId: providerProfiles.userId })
    .from(providerProfiles)
    .where(eq(providerProfiles.authorId, skillAuthorId))
    .limit(1)
  if (!profile) return
  await notifyUser({ userId: profile.userId, type: 'skill_review', title, body, metadata: { skillId } })
}

type DecideInput = {
  /** Review id or skill id; both resolve to the same skill. */
  id: string
  decision: 'pass' | 'reject' | 'needs_revision'
  comment?: string
  reviewerId: string
}

/**
 * Apply one review decision.
 *
 * Shared by `decide` and `batchDecide` so a batch cannot drift from a single
 * decision. The write touches the skill row and its open review row, then
 * recomputes the eval report so the published grade matches the decision.
 */
async function decideOne(input: DecideInput) {
  const { id, decision, comment, reviewerId } = input

  if ((decision === 'reject' || decision === 'needs_revision') && !comment?.trim()) {
    return { success: false as const, error: '驳回和要求修改必须填写审核意见' }
  }

  // Accept either identifier: queue links carry the review id, the rejected
  // list links the skill id.
  const [reviewById] = await db
    .select({ id: skillReviews.id, skillId: skillReviews.skillId })
    .from(skillReviews)
    .where(eq(skillReviews.id, id))
    .limit(1)

  const skillId = reviewById?.skillId ?? id
  const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1)
  if (!skill) return { success: false as const, error: 'Skill 不存在' }

  const now = new Date()
  const submitted = skill.scannedAt ?? skill.createdAt
  const durationMinutes = Math.max(0, Math.round((now.getTime() - submitted.getTime()) / 60_000))
  const nextStatus = decision === 'pass' ? 'published' : decision === 'reject' ? 'rejected' : 'needs_revision'
  const reviewStatus = decision === 'pass' ? 'passed' : decision === 'reject' ? 'rejected' : 'needs_revision'

  await db
    .update(skills)
    .set({
      status: nextStatus,
      reviewStatus,
      reviewedBy: reviewerId,
      reviewedAt: now,
      reviewComment: comment ?? null,
      // Passing certifies; the other two outcomes leave any existing
      // certification alone.
      certified: decision === 'pass' ? true : skill.certified,
      certifiedAt: decision === 'pass' ? now : skill.certifiedAt,
      certifiedBy: decision === 'pass' ? reviewerId : skill.certifiedBy,
      publishedAt: decision === 'pass' ? (skill.publishedAt ?? now) : skill.publishedAt,
      updatedAt: now,
    })
    .where(eq(skills.id, skill.id))

  const [openReview] = await db
    .select({ id: skillReviews.id })
    .from(skillReviews)
    .where(and(eq(skillReviews.skillId, skill.id), isNull(skillReviews.decision)))
    .orderBy(desc(skillReviews.createdAt))
    .limit(1)

  if (openReview) {
    await db
      .update(skillReviews)
      .set({ reviewerId, decision, reviewComment: comment ?? null, durationMinutes })
      .where(eq(skillReviews.id, openReview.id))
  } else {
    await db.insert(skillReviews).values({
      skillId: skill.id,
      reviewType: 'manual',
      reviewerId,
      decision,
      reviewComment: comment ?? null,
      flaggedFlags: skill.securityFlags,
      scanRulesVersion: skill.scanRulesVersion,
      scanGrade: skill.securityGrade,
      llmGrade: skill.securityLlmGrade,
      durationMinutes,
    })
  }

  // The eval report reads `certified` and `securityGrade`, both of which just
  // changed. A failure here must not fail the review: the decision is already
  // recorded, and a later pass can recompute it.
  await computeAndPersistEvalReport(skill.id).catch((err: unknown) => {
    console.error('[skill-reviews] evalReport persist failed', skill.id, err)
  })

  const title =
    decision === 'pass'
      ? `Skill 已通过审核：${skill.title}`
      : decision === 'reject'
        ? `Skill 已被驳回：${skill.title}`
        : `Skill 需要修改：${skill.title}`
  await notifyProvider(skill.authorId, title, comment?.trim() || title, skill.id).catch((err: unknown) => {
    console.error('[skill-reviews] notify failed', skill.id, err)
  })

  const [row] = await db
    .select(reviewSelect)
    .from(skillReviews)
    .innerJoin(skills, eq(skillReviews.skillId, skills.id))
    .innerJoin(authors, eq(skills.authorId, authors.id))
    .leftJoin(user, eq(skillReviews.reviewerId, user.id))
    .where(eq(skillReviews.skillId, skill.id))
    .orderBy(desc(skillReviews.createdAt))
    .limit(1)

  return { success: true as const, data: row ? toReviewRecord(row as ReviewRow) : null }
}

export const adminSkillReviewsRouter = createTRPCRouter({
  /**
   * Manual review queue: skills waiting on a human.
   *
   * Joined against the open (`decision IS NULL`) manual review row, so a skill
   * whose queue entry was already decided drops out of the queue.
   */
  getQueue: adminProcedure.input(queueSchema).query(async ({ input }) => {
    const where = [eq(skills.status, 'pending_review')]
    if (input?.source && input.source !== 'all') where.push(eq(skills.sourceType, input.source))
    if (input?.trustTier) where.push(eq(skills.trustTier, input.trustTier))
    if (input?.search) {
      const needle = `%${input.search}%`
      where.push(
        or(ilike(skills.title, needle), ilike(skills.slug, needle), ilike(authors.username, needle))!
      )
    }

    const page = input?.page ?? 1
    const pageSize = input?.pageSize ?? 20
    const whereExpr = and(...where)

    const [rows, [totalRow]] = await Promise.all([
      db
        .select(reviewSelect)
        .from(skills)
        .innerJoin(authors, eq(skills.authorId, authors.id))
        .leftJoin(
          skillReviews,
          and(
            eq(skillReviews.skillId, skills.id),
            isNull(skillReviews.decision),
            eq(skillReviews.reviewType, 'manual')
          )
        )
        .where(whereExpr)
        // 排队时长从 skills.scannedAt 算起（提交时间），所以直接按它倒序即最久等待在前
        .orderBy(desc(sql`coalesce(${skills.scannedAt}, ${skills.updatedAt})`))
        .limit(pageSize)
        .offset((page - 1) * pageSize) as Promise<ReviewRow[]>,
      db
        .select({ n: count() })
        .from(skills)
        .innerJoin(authors, eq(skills.authorId, authors.id))
        .where(whereExpr),
    ])

    const total = totalRow?.n ?? 0
    return {
      success: true as const,
      data: rows.map(toReviewRecord),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }),

  /** Auto-rejected and human-rejected items, newest first. */
  getRejected: adminProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(100).optional(),
          decision: z.enum(['all', 'auto_reject', 'reject']).default('all'),
        })
        .merge(pageSchema)
        .optional()
    )
    .query(async ({ input }) => {
      const where = [
        input?.decision === 'auto_reject'
          ? eq(skillReviews.reviewType, 'auto_reject')
          : input?.decision === 'reject'
            ? eq(skillReviews.decision, 'reject')
            : or(eq(skillReviews.reviewType, 'auto_reject'), eq(skillReviews.decision, 'reject'))!,
      ]
      if (input?.search) {
        const needle = `%${input.search}%`
        where.push(or(ilike(skills.title, needle), ilike(skills.slug, needle), ilike(authors.username, needle))!)
      }

      const page = input?.page ?? 1
      const pageSize = input?.pageSize ?? 20
      const whereExpr = and(...where)

      const [rows, [totalRow]] = await Promise.all([
        db
          .select(reviewSelect)
          .from(skillReviews)
          .innerJoin(skills, eq(skillReviews.skillId, skills.id))
          .innerJoin(authors, eq(skills.authorId, authors.id))
          .leftJoin(user, eq(skillReviews.reviewerId, user.id))
          .where(whereExpr)
          .orderBy(desc(skillReviews.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize) as Promise<ReviewRow[]>,
        db
          .select({ n: count() })
          .from(skillReviews)
          .innerJoin(skills, eq(skillReviews.skillId, skills.id))
          .innerJoin(authors, eq(skills.authorId, authors.id))
          .where(whereExpr),
      ])

      const total = totalRow?.n ?? 0
      return {
        success: true as const,
        // 按 review id 展示：一个 skill 可以被驳回多次，这个列表要看到每一次
        data: rows.map(toReviewRecord),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      }
    }),

  /** Every decision ever recorded, filterable by outcome. */
  getHistory: adminProcedure.input(historySchema).query(async ({ input }) => {
    const where = [isNotNull(skillReviews.decision)]
    if (input?.decision && input.decision !== 'all') where.push(eq(skillReviews.decision, input.decision))
    if (input?.search) {
      const needle = `%${input.search}%`
      where.push(
        or(
          ilike(skills.title, needle),
          ilike(authors.username, needle),
          ilike(user.name, needle)
        )!
      )
    }

    const page = input?.page ?? 1
    const pageSize = input?.pageSize ?? 20
    const whereExpr = and(...where)

    const [rows, [totalRow]] = await Promise.all([
      db
        .select(reviewSelect)
        .from(skillReviews)
        .innerJoin(skills, eq(skillReviews.skillId, skills.id))
        .innerJoin(authors, eq(skills.authorId, authors.id))
        .leftJoin(user, eq(skillReviews.reviewerId, user.id))
        .where(whereExpr)
        .orderBy(desc(skillReviews.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize) as Promise<ReviewRow[]>,
      db
        .select({ n: count() })
        .from(skillReviews)
        .innerJoin(skills, eq(skillReviews.skillId, skills.id))
        .innerJoin(authors, eq(skills.authorId, authors.id))
        .leftJoin(user, eq(skillReviews.reviewerId, user.id))
        .where(whereExpr),
    ])

    const total = totalRow?.n ?? 0
    return {
      success: true as const,
      data: rows.map(toReviewRecord),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }),

  /** Queue counters, counted in SQL rather than in memory. */
  getStats: adminProcedure.query(async () => {
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)

    const [pendingRow, autoRejectedRow, todayRow, totalRow] = await Promise.all([
      db.select({ value: count() }).from(skills).where(eq(skills.status, 'pending_review')),
      db
        .select({ value: count() })
        .from(skillReviews)
        .where(eq(skillReviews.reviewType, 'auto_reject')),
      db
        .select({ value: count() })
        .from(skillReviews)
        .where(and(isNotNull(skillReviews.decision), gte(skillReviews.createdAt, startOfDay))),
      db.select({ value: count() }).from(skillReviews).where(isNotNull(skillReviews.decision)),
    ])

    return {
      success: true as const,
      data: {
        pending: pendingRow?.[0]?.value ?? 0,
        autoRejected: autoRejectedRow?.[0]?.value ?? 0,
        decidedToday: todayRow?.[0]?.value ?? 0,
        totalDecided: totalRow?.[0]?.value ?? 0,
      },
    }
  }),

  /** One review record, by review id. */
  getById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const [row] = (await db
      .select(reviewSelect)
      .from(skillReviews)
      .innerJoin(skills, eq(skillReviews.skillId, skills.id))
      .innerJoin(authors, eq(skills.authorId, authors.id))
      .leftJoin(user, eq(skillReviews.reviewerId, user.id))
      .where(eq(skillReviews.id, input.id))
      .limit(1)) as ReviewRow[]

    if (!row) return { success: false as const, error: '审核记录不存在', data: null }
    return { success: true as const, data: toReviewRecord(row) }
  }),

  /**
   * The review history for one skill, newest first.
   *
   * This is what the detail page needs: a reviewer wants the full trail, not
   * just whichever record happens to match an id.
   */
  getBySkillId: adminProcedure.input(z.object({ skillId: z.string() })).query(async ({ input }) => {
    const rows = (await db
      .select(reviewSelect)
      .from(skills)
      .innerJoin(authors, eq(skills.authorId, authors.id))
      .leftJoin(skillReviews, eq(skillReviews.skillId, skills.id))
      .leftJoin(user, eq(skillReviews.reviewerId, user.id))
      .where(eq(skills.id, input.skillId))
      .limit(1)) as ReviewRow[]

    // scanScans join 已移除（相关子查询取代），这里已是「一条 review 一行」
    const decided = rows
      .filter((row) => row.decision != null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    if (decided.length === 0) {
      return { success: false as const, error: '审核记录不存在', data: null }
    }
    return { success: true as const, data: decided.map(toReviewRecord) }
  }),

  /**
   * Record a human decision.
   *
   * Reject and needs_revision require a comment: the author is notified with
   * it, and "no reason given" is not actionable.
   */
  decide: adminProcedure
    .input(
      z.object({
        /** Review id or skill id; both resolve to the same skill. */
        id: z.string(),
        decision: z.enum(['pass', 'reject', 'needs_revision']),
        comment: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const outcome = await decideOne({
        id: input.id,
        decision: input.decision,
        comment: input.comment,
        reviewerId: ctx.user.id,
      })
      if (!outcome.success) {
        return { success: false as const, error: outcome.error }
      }
      return { success: true as const, data: outcome.data }
    }),

  /**
   * Decide many items at once.
   *
   * Sequential on purpose: each decision writes three tables and sends a
   * notification, so a single transaction would hold locks across network calls
   * and one bad row would discard the rest. The response reports per-item
   * results so the console can show what actually landed.
   */
  batchDecide: adminProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(50),
        decision: z.enum(['pass', 'reject']),
        comment: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const results: { id: string; success: boolean; error?: string }[] = []
      for (const id of input.ids) {
        const outcome = await decideOne({
          id,
          decision: input.decision,
          comment: input.comment,
          reviewerId: ctx.user.id,
        })
        results.push(
          outcome.success
            ? { id, success: true }
            : { id, success: false, error: outcome.error }
        )
      }
      return {
        success: true as const,
        data: {
          total: results.length,
          succeeded: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
          results,
        },
      }
    }),

  /**
   * Put a rejected skill back in the review queue.
   *
   * Adds a fresh open review row rather than reopening the rejected one: the
   * reject and the restore both stay in the history, which is the point of
   * having a history.
   */
  restore: superAdminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const [reviewById] = await db
      .select({ id: skillReviews.id, skillId: skillReviews.skillId })
      .from(skillReviews)
      .where(eq(skillReviews.id, input.id))
      .limit(1)
    const skillId = reviewById?.skillId ?? input.id

    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1)
    if (!skill) return { success: false as const, error: 'Skill 不存在' }

    const now = new Date()
    await db
      .update(skills)
      .set({
        status: 'pending_review',
        reviewStatus: 'pending_review',
        reviewedBy: ctx.user.id,
        reviewedAt: now,
        reviewComment: '已从自动驳回恢复到复核队列',
        updatedAt: now,
      })
      .where(eq(skills.id, skill.id))

    const [inserted] = await db
      .insert(skillReviews)
      .values({
        skillId: skill.id,
        reviewType: 'manual',
        reviewerId: ctx.user.id,
        scanRulesVersion: skill.scanRulesVersion,
        scanGrade: skill.securityGrade,
        llmGrade: skill.securityLlmGrade,
        flaggedFlags: skill.securityFlags,
        reviewComment: 'restored_to_queue',
      })
      .returning({ id: skillReviews.id })

    return { success: true as const, data: { skillId: skill.id, reviewId: inserted?.id ?? null } }
  }),

  /**
   * Re-run the security scan for a skill.
   *
   * Does not change `reviewStatus`: a rescan informs the next decision, it does
   * not make one.
   */
  rescan: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const [reviewById] = await db
      .select({ id: skillReviews.id, skillId: skillReviews.skillId })
      .from(skillReviews)
      .where(eq(skillReviews.id, input.id))
      .limit(1)
    const skillId = reviewById?.skillId ?? input.id

    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1)
    if (!skill) return { success: false as const, error: 'Skill 不存在' }

    const files = await filesFromSkillRow(skill)
    const result = await runSkillSecurityScan({ skillId: skill.id, files, context: {} })

    return {
      success: true as const,
      data: {
        skillId: skill.id,
        grade: result.grade,
        llmGrade: result.llmGrade ?? null,
        flags: result.flags ?? [],
        trustTier: result.trustTier ?? null,
      },
    }
  }),

  /**
   * Send the owner a "please fix this" note without deciding anything.
   *
   * `needs_revision` already does this, so this exists for the case where a
   * reviewer wants to ask a question and has no verdict to record yet.
   */
  comment: adminProcedure
    .input(z.object({ id: z.string(), comment: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const [reviewById] = await db
        .select({ id: skillReviews.id, skillId: skillReviews.skillId })
        .from(skillReviews)
        .where(eq(skillReviews.id, input.id))
        .limit(1)
      const skillId = reviewById?.skillId ?? input.id

      const [skill] = await db.select({ title: skills.title, authorId: skills.authorId }).from(skills).where(eq(skills.id, skillId)).limit(1)
      if (!skill) return { success: false as const, error: 'Skill 不存在' }

      await notifyProvider(skill.authorId, `Skill 审核意见：${skill.title}`, input.comment, skillId)

      const [open] = await db
        .select({ id: skillReviews.id })
        .from(skillReviews)
        .where(and(eq(skillReviews.skillId, skillId), isNull(skillReviews.decision)))
        .orderBy(desc(skillReviews.createdAt))
        .limit(1)

      if (open) {
        await db
          .update(skillReviews)
          .set({ reviewComment: input.comment, reviewerId: ctx.user.id })
          .where(eq(skillReviews.id, open.id))
      }

      return { success: true as const, data: { skillId, notified: true } }
    }),
})
