import { getLocale } from 'next-intl/server'
import { z } from 'zod'
import { failResult, listingInput } from "@/lib/gateway/input"
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/routers/trpc"
import { getAuthorForUser, requireAuthorForUser, requireVerifiedProviderForPublish } from "@/web/providers/author"
import { acquireSkill } from './acquire'
import { emptyPage, mineListInput } from '@/web/assets/mine-list'
import { skillsGatewayAccess } from './gateway'
import { skillsHistoryAccess } from './history'
import { skillsDataAccess } from './index'
import { createSkillPurchase, hasSkillEntitlement } from './purchase'
import {
  listSkillVersions,
  getSkillVersion,
  createSkillVersion,
  publishSkillVersion,
  setCurrentVersion,
  yankSkillVersion,
} from './versions'

export const skillsRouter = createTRPCRouter({
  getSkills: publicProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        categorySlugs: z.array(z.string()).optional(),
        priceType: z.enum(['free', 'paid']).optional(),
        certified: z.boolean().optional(),
        timePeriod: z.enum(['7d', '1m', '3m', 'all']).optional(),
        sort: z.enum(['date-desc', 'date-asc', 'downloads-desc', 'views-desc', 'popularity-desc']).optional(),
        authorUsername: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const locale = (await getLocale()) as 'zh' | 'en'
        const list = await skillsDataAccess.getSkills({ ...input, locale })
        const total = await skillsDataAccess.getSkillsCount(input)
        return {
          success: true,
          data: list,
          pagination: {
            page: input.page,
            limit: input.limit,
            total,
            totalPages: Math.ceil(total / input.limit),
          },
        }
      } catch (error) {
        return failResult(error, '获取技能列表失败')
      }
    }),

  getSkillById: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const skill = await skillsDataAccess.getSkillById(input.id, locale)
      if (!skill) {
        return { success: false, error: '技能未找到' }
      }
      await skillsDataAccess.incrementViews(input.id)
      return { success: true, data: skill }
    } catch (error) {
      return failResult(error, '获取技能详情失败')
    }
  }),

  getSkillBySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const skill = await skillsDataAccess.getSkillBySlug(input.slug, locale)
      if (!skill) {
        return { success: false, error: '技能未找到' }
      }
      await skillsDataAccess.incrementViews(skill.id)
      return { success: true, data: skill }
    } catch (error) {
      return failResult(error, '获取技能详情失败')
    }
  }),

  getRelatedSkills: publicProcedure
    .input(z.object({ id: z.string(), limit: z.number().min(1).max(12).default(6) }))
    .query(async ({ input }) => {
      try {
        const locale = (await getLocale()) as 'zh' | 'en'
        const data = await skillsDataAccess.getRelatedSkills({ skillId: input.id, limit: input.limit, locale })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '获取相关技能失败')
      }
    }),

  listMine: protectedProcedure.input(mineListInput).query(async ({ ctx, input }) => {
    try {
      const { authorId } = await getAuthorForUser(ctx.user.id)
      if (!authorId) return { success: true, data: emptyPage() }
      return { success: true, data: await skillsGatewayAccess.listMine(authorId, input) }
    } catch (error) {
      return failResult(error, '获取我的 Skill 失败')
    }
  }),

  getMine: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      const data = await skillsGatewayAccess.getMineById(authorId, input.id)
      if (!data) return { success: false, error: 'Skill 不存在' }
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取 Skill 失败')
    }
  }),

  /** Install history for the signed-in user, used by the console. */
  listMyInstalls: protectedProcedure.query(async ({ ctx }) => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const data = await skillsHistoryAccess.listInstalls(ctx.user.id, locale)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取安装记录失败')
    }
  }),

  /** Mark one of the user's install records as removed, or restore it. */
  setMyInstallStatus: protectedProcedure
    .input(
      z.object({
        installId: z.string(),
        status: z.enum(['active', 'removed']),
        kind: z.enum(['skill', 'mcp', 'a2a']).default('skill'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await skillsHistoryAccess.setInstallStatus(
          ctx.user.id,
          input.installId,
          input.status,
          input.kind
        )
        if (!result.ok) return { success: false, error: result.error ?? '操作失败' }
        return { success: true }
      } catch (error) {
        return failResult(error, '更新安装状态失败')
      }
    }),

  checkGithub: protectedProcedure.input(z.object({ repoUrl: z.string().min(8).max(500) })).query(async ({ input }) => {
    try {
      const data = await skillsGatewayAccess.checkGithubRepo(input.repoUrl)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '检查仓库失败')
    }
  }),

  /**
   * Hand the repository to `apps/console` and report whether it is usable.
   *
   * `ready` is the answer the submit dialog needs before it is worth polling:
   * an unindexed repository cannot be registered, because there is no GitHub
   * data to send and console has no bare-URL endpoint, so it is reported as
   * not ready immediately instead of after a minute of polling that can only
   * time out.
   *
   * `mode` travels with it because in `register` mode nothing is published and
   * no skill document is ever pushed back, so the dialog must not poll for one.
   * `pending` says the same for `publish` mode, where the answer console gives
   * (`delivered`) is true even when it read no skill document at all - polling
   * there would wait a full minute for a push that is not coming.
   */
  registerWithConsole: protectedProcedure
    .input(z.object({ repoUrl: z.string().min(8).max(500) }))
    .mutation(async ({ input }) => {
      try {
        const data = await skillsGatewayAccess.registerWithConsole(input.repoUrl)
        return { success: true, data }
      } catch (error) {
        return failResult(error, '同步仓库失败')
      }
    }),

  pollSync: protectedProcedure.input(z.object({ repoUrl: z.string().min(8).max(500) })).query(async ({ input }) => {
    try {
      const data = await skillsGatewayAccess.pollSync(input.repoUrl)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '轮询同步状态失败')
    }
  }),

  connectFromGithub: protectedProcedure
    .input(z.object({ repoUrl: z.string().min(8).max(500), name: z.string().max(200).nullish() }).merge(listingInput))
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireVerifiedProviderForPublish(ctx.user.id, {
          requirePayChannel: input.priceType === 'paid',
        })
        const data = await skillsGatewayAccess.connectFromGithub({
          authorId,
          repoUrl: input.repoUrl,
          name: input.name,
          imageUrl: input.imageUrl,
          description: input.description,
          visibility: input.scope,
          priceType: input.priceType,
          billingModel: input.billingModel,
          priceAmount: input.priceAmount,
          unitPrice: input.unitPrice,
        })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '接入 GitHub Skill 失败')
      }
    }),

  connectFromParsed: protectedProcedure
    .input(
      z
        .object({
          name: z.string().min(1).max(200),
          version: z.string().max(100).nullish(),
          license: z.string().max(100).nullish(),
          files: z
            .array(z.object({ path: z.string().max(500), content: z.string().max(5_000_000) }))
            .min(1)
            .max(200),
        })
        .merge(listingInput.partial())
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireVerifiedProviderForPublish(ctx.user.id, {
          requirePayChannel: input.priceType === 'paid',
        })
        const data = await skillsGatewayAccess.connectFromParsed({
          authorId,
          name: input.name,
          imageUrl: input.imageUrl,
          description: input.description,
          version: input.version,
          license: input.license,
          files: input.files,
          visibility: input.scope,
          priceType: input.priceType,
          billingModel: input.billingModel,
          priceAmount: input.priceAmount,
          unitPrice: input.unitPrice,
        })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '接入 ZIP Skill 失败')
      }
    }),

  rescan: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      const data = await skillsGatewayAccess.rescan(authorId, input.id)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '重新扫描失败')
    }
  }),

  publish: protectedProcedure
    .input(z.object({ id: z.string() }).merge(listingInput.partial()))
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireVerifiedProviderForPublish(ctx.user.id, {
          requirePayChannel: input.priceType === 'paid',
        })
        const data = await skillsGatewayAccess.publish(authorId, input.id, {
          description: input.description,
          visibility: input.scope,
          imageUrl: input.imageUrl,
          priceType: input.priceType,
          billingModel: input.billingModel,
          priceAmount: input.priceAmount,
          unitPrice: input.unitPrice,
        })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '提交上架失败')
      }
    }),

  toggle: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const data = await skillsGatewayAccess.toggle(authorId, input.id, input.enabled)
        return { success: true, data }
      } catch (error) {
        return failResult(error, '更新状态失败')
      }
    }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      await skillsGatewayAccess.remove(authorId, input.id)
      return { success: true }
    } catch (error) {
      return failResult(error, '删除失败')
    }
  }),

  /** 查询当前用户是否已购买/解锁该 Skill */
  hasEntitlement: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const entitled = await hasSkillEntitlement(ctx.user.id, input.id)
      return { success: true as const, data: { entitled } }
    } catch (error) {
      return failResult(error, '查询授权失败')
    }
  }),

  /**
   * 付费购买：钱包扣款 + 写入 skill_entitlements。余额不足返回 needRecharge。
   */
  createPurchase: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      const result = await createSkillPurchase({ userId: ctx.user.id, skillId: input.id })
      if (!result.ok) {
        return {
          success: false as const,
          error: result.error,
          code: result.code,
          needRecharge: result.needRecharge ?? false,
          rechargeUrl: result.rechargeUrl,
          requiredAmount: result.requiredAmount,
          balance: result.balance,
        }
      }
      return {
        success: true as const,
        data: {
          alreadyOwned: result.alreadyOwned,
          entitlementId: result.entitlementId,
          amount: result.amount,
          currency: result.currency,
          balanceAfter: result.balanceAfter,
        },
      }
    } catch (error) {
      return failResult(error, '购买失败')
    }
  }),

  /**
   * 免费/已购技能获取：记 downloads + 返回交付载荷（GitHub URL 或文件列表）
   * 支持可选的 version 参数来获取特定版本
   */
  acquire: protectedProcedure
    .input(z.object({ 
      id: z.string(),
      version: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const locale = (await getLocale()) as 'zh' | 'en'
        const result = await acquireSkill({
          skillId: input.id,
          userId: ctx.user.id,
          version: input.version,
          locale,
          ipAddress: ctx.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
          userAgent: ctx.headers.get('user-agent'),
        })
        if (!result.ok) {
          return { success: false as const, error: result.error, code: result.code }
        }
        return { success: true as const, data: result.delivery }
      } catch (error) {
        return failResult(error, '获取技能失败')
      }
    }),

  /**
   * 版本管理：列出 Skill 的所有版本
   * Provider 可见所有状态，普通用户仅可见已发布版本
   */
  listVersions: publicProcedure
    .input(z.object({ 
      skillId: z.string(),
      isProvider: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const data = await listSkillVersions({
          skillId: input.skillId,
          userId: ctx.user?.id,
          isProvider: input.isProvider ?? false,
        })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '获取版本列表失败')
      }
    }),

  /**
   * 版本管理：获取特定版本详情
   */
  getVersion: publicProcedure
    .input(z.object({ 
      skillId: z.string(),
      version: z.string(),
    }))
    .query(async ({ input }) => {
      try {
        const data = await getSkillVersion(input)
        if (!data) {
          return { success: false, error: '版本不存在' }
        }
        return { success: true, data }
      } catch (error) {
        return failResult(error, '获取版本详情失败')
      }
    }),

  /**
   * 版本管理：创建新版本（Provider only）
   */
  createVersion: protectedProcedure
    .input(z.object({
      skillId: z.string(),
      version: z.string(),
      changelog: z.string().optional(),
      autoPublish: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Verify provider ownership
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const skill = await skillsGatewayAccess.getMineById(authorId, input.skillId)
        if (!skill) {
          return { success: false, error: 'Skill 不存在或无权限' }
        }

        const result = await createSkillVersion({
          skillId: input.skillId,
          version: input.version,
          userId: ctx.user.id,
          changelog: input.changelog,
          autoPublish: input.autoPublish,
        })

        if (!result.ok) {
          return { success: false, error: result.error }
        }

        return { success: true, data: { versionId: result.versionId } }
      } catch (error) {
        return failResult(error, '创建版本失败')
      }
    }),

  /**
   * 版本管理：发布草稿版本（Provider only）
   */
  publishVersion: protectedProcedure
    .input(z.object({
      skillId: z.string(),
      version: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const skill = await skillsGatewayAccess.getMineById(authorId, input.skillId)
        if (!skill) {
          return { success: false, error: 'Skill 不存在或无权限' }
        }

        const result = await publishSkillVersion({
          skillId: input.skillId,
          version: input.version,
          userId: ctx.user.id,
        })

        if (!result.ok) {
          return { success: false, error: result.error }
        }

        return { success: true }
      } catch (error) {
        return failResult(error, '发布版本失败')
      }
    }),

  /**
   * 版本管理：设置当前版本（回滚，Provider only）
   */
  setCurrentVersion: protectedProcedure
    .input(z.object({
      skillId: z.string(),
      version: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const skill = await skillsGatewayAccess.getMineById(authorId, input.skillId)
        if (!skill) {
          return { success: false, error: 'Skill 不存在或无权限' }
        }

        const result = await setCurrentVersion({
          skillId: input.skillId,
          version: input.version,
          userId: ctx.user.id,
        })

        if (!result.ok) {
          return { success: false, error: result.error }
        }

        return { success: true }
      } catch (error) {
        return failResult(error, '设置当前版本失败')
      }
    }),

  /**
   * 版本管理：撤回版本（Provider only）
   */
  yankVersion: protectedProcedure
    .input(z.object({
      skillId: z.string(),
      version: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const skill = await skillsGatewayAccess.getMineById(authorId, input.skillId)
        if (!skill) {
          return { success: false, error: 'Skill 不存在或无权限' }
        }

        const result = await yankSkillVersion({
          skillId: input.skillId,
          version: input.version,
          userId: ctx.user.id,
        })

        if (!result.ok) {
          return { success: false, error: result.error }
        }

        return { success: true }
      } catch (error) {
        return failResult(error, '撤回版本失败')
      }
    }),
})
