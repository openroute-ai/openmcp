/**
 * API key 签发与吊销。
 *
 * 全部 `adminProcedure`，且**全部走 tRPC 而不是 `/api/v1`** —— 否则任何人都能给
 * 自己发一把 key，开放 API 的第一个端点就变成了自我授权的入口。"谁有权给别人
 * 发凭据"是账号系统的问题，而 console 的账号与 web 完全独立，所以这件事不需要
 * 任何跨应用的参与。
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { apiKeys } from "@/db/schema/api-keys"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { user } from "@/db/schema"
import {
  issueApiKey,
  normalizeScopes,
  revokeApiKey,
  rotateApiKey,
} from "@/lib/api/keys"
import { API_SCOPES } from "@/lib/api/scopes"
import { adminProcedure, createTRPCRouter } from "../init"

/**
 * 幂等轮换的输入里没有 `scopes`：新 key 照抄旧的。
 *
 * 轮换的动机是换掉一把泄漏的机密，不是改权限；把两者合成一次操作，会让一把
 * 已泄漏的 key 在轮换的同时悄悄获得更大的权限。
 */
export const apiKeysRouter = createTRPCRouter({
  /**
   * 签发一把新 key。明文**只**出现在这一次响应里。
   *
   * 不设幂等键：签发不是重试安全的操作，客户端重试一次就多一把 key，而多一把
   * 无人记录的 key 恰恰是签发要避免的结果。需要重试的调用方应当先 `list` 确认。
   */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        scopes: z.array(z.enum(API_SCOPES)).min(1),
        /** 这把 key 提交仓库时 `user_repos` 记谁。`null` 表示不记到任何人。 */
        submitterId: z.string().min(1).nullable().optional(),
        expiresAt: z.coerce.date().nullable().optional(),
        rateLimitRpm: z.number().int().min(1).max(1000).optional(),
        rateLimitRpd: z.number().int().min(1).max(1_000_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 提交者必须是真实存在的账号。不在这里校验，错误就会推迟到
      // `POST /api/v1/repos` 提交时以外键违例的形式出现，而那时持有者已经拿到了
      // 一把永远用不了 `submitterId` 的 key。
      if (input.submitterId) {
        const [submitter] = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, input.submitterId))
          .limit(1)

        if (!submitter) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No account with id ${input.submitterId}`,
          })
        }
      }

      const issued = await issueApiKey(ctx.db, {
        name: input.name,
        scopes: input.scopes,
        createdBy: ctx.session.user.id,
        submitterId: input.submitterId ?? null,
        expiresAt: input.expiresAt ?? null,
        rateLimitRpm: input.rateLimitRpm,
        rateLimitRpd: input.rateLimitRpd,
      })

      return {
        id: issued.id,
        name: issued.name,
        prefix: issued.prefix,
        scopes: issued.scopes,
        createdAt: issued.createdAt,
        secret: issued.secret,
      }
    }),

  /**
   * key 列表。默认带 `onlyActive`，因为那是一个管理界面最常被问的问题——
   * "现在有哪些 key 在用"。
   *
   * **不含明文，也不含 `keyHash`**。第一次读取之后明文就不可得，所以这份列表
   * 不能回答"我上次那把 key 是什么"，只能回答"我还有几把 key"；后者要回答"上一把
   * 是什么"只能轮换。
   */
  list: adminProcedure
    .input(
      z.object({
        onlyActive: z.boolean().default(true),
        createdBy: z.string().min(1).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = []
      if (input.onlyActive) {
        conditions.push(
          isNull(apiKeys.revokedAt),
          sql`(${apiKeys.expiresAt} is null or ${apiKeys.expiresAt} > now())`
        )
      }
      if (input.createdBy) {
        conditions.push(eq(apiKeys.createdBy, input.createdBy))
      }

      const rows = await ctx.db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          scopes: apiKeys.scopes,
          submitterId: apiKeys.submitterId,
          rateLimitRpm: apiKeys.rateLimitRpm,
          rateLimitRpd: apiKeys.rateLimitRpd,
          expiresAt: apiKeys.expiresAt,
          revokedAt: apiKeys.revokedAt,
          revokedReason: apiKeys.revokedReason,
          lastUsedAt: apiKeys.lastUsedAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(apiKeys.createdAt))

      return rows.map((row) => ({ ...row, scopes: normalizeScopes(row.scopes) }))
    }),

  /**
   * 吊销。立即生效——鉴权每次都读库，没有缓存要清。
   *
   * 对已吊销的 key 再吊销一次不报错，第二个理由会被忽略：这让"重复点一次确认"
   * 是安全的，而返回一个错误只会让人怀疑第一次是否真的生效了。
   */
  revoke: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        reason: z.string().trim().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const revoked = await revokeApiKey(
        ctx.db,
        input.id,
        input.reason ?? null
      )
      return { id: input.id, revoked }
    }),

  /**
   * 轮换：吊销旧的 + 签发新的，同一个事务。
   *
   * 返回新 key 的明文一次。旧的**立即**失效，中间不存在两把 key 同时有效的窗口。
   *
   * 对已吊销的 key 轮换会报错：那几乎总是调用方的状态没刷新，而默默接受会留下一
   * 条比原始吊销更晚的吊销记录，读起来像"恢复过"。
   */
  rotate: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await rotateApiKey(ctx.db, input.id).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes("already revoked")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message })
        }
        throw error
      })

      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })
      }

      return {
        revokedId: result.revokedId,
        issued: {
          id: result.issued.id,
          name: result.issued.name,
          prefix: result.issued.prefix,
          scopes: result.issued.scopes,
          createdAt: result.issued.createdAt,
          secret: result.issued.secret,
        },
      }
    }),
})