/**
 * API key 的签发、治理与自助管理。
 *
 * ## 两条路径，一组判断
 *
 * 这个 router 有两族入口，区别只在 procedure 上：
 *
 * - **admin 族**（`adminProcedure`）：签发接入方 key、代用户签发、改权限、改配额、
 *   吊销。管理员可以做任何事，因为管理员是信任边界内部的人。
 * - **自助族**（`protectedProcedure`）：`listMine` / `createMine` / `revokeMine` /
 *   `rotateMine` / `surrender`。任何一个登录用户都可以调用。
 *
 * 权限边界**不**只由 `adminProcedure` 承担。自助那五个 procedure 里有四个会改到
 * 凭据，而 `protectedProcedure` 唯一保证的是"有人登录了"。所以归属判断在
 * `lib/api/ownership.ts` 的服务层里：`assertSelfServiceScopes` 挡越权 scope，
 * `assertKeyBelongsTo` 挡"吊销别人的 key"，两者都在 router 的输入 schema 之后、
 * 落库之前。这看起来像重复劳动，而它存在的理由是 `createMine` 与 `create` 的输入
 * 字段几乎相同——把区别写成两个 router 里各一份 `if`，下一个新 mutation 就会以为
 * "前面已经检查过了"。
 *
 * ## 明文
 *
 * 明文只在 `create`、`createMine`、`rotate`、`rotateMine` 的响应里出现一次，任何
 * 其他入口都不返回它，因为数据库里只有 SHA-256。列表接口因此回答不了"我上次那把
 * key 是什么"，只能回答"我还有几把"——后者要恢复只能轮换。
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { and, desc, eq, isNull, or, sql } from "drizzle-orm"
import { apiKeys } from "@/db/schema/api-keys"
import { apiRequestAudit } from "@/db/schema/api-request-audit"
import { user } from "@/db/schema"
import { clientIpFromHeaders, writeApiAudit } from "@/lib/api/audit"
import {
  issueApiKey,
  normalizeScopes,
  revokeApiKey,
  rotateApiKey,
  surrenderApiKey,
  updateApiKeyLimits,
  updateApiKeyScopes,
} from "@/lib/api/keys"
import { assertKeyBelongsTo } from "@/lib/api/ownership"
import { issueSelfServiceKey } from "@/lib/api/self-service"
import {
  API_SCOPES,
  API_TIERS,
  SELF_SERVICE_SCOPES,
  TIER_DEFAULTS,
  type ApiScope,
  type ApiTier,
} from "@/lib/api/scopes"
import { adminProcedure, createTRPCRouter, protectedProcedure } from "../init"

/**
 * 主动吊销必须给理由。
 *
 * `min(1)` 而不��� `optional()`：吊销是唯一一个"用户之后一定会想知道为什么"的治理
 * 动作——上周你为什么签了两把 key、其中一把今天不见了。理由只存进 `revoked_reason`
 * 列和审计行，没有别的消费者，而唯一的一次填写成本换来的是"这把 key 为什么不见了"
 * 这个问题在三个月后仍可回答。
 */
const revokeReason = z.string().trim().min(1).max(500)

/**
 * `list` / `listMine` 共用的投影。
 *
 * 一份投影而不是两���：两处各写一遍字段，意味着"要不要显示 `lastRotatedAt`"这种
 * 问题会被回答两次，而答案只取决于其中一个界面的需要。
 */
const keyColumns = {
  id: apiKeys.id,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  scopes: apiKeys.scopes,
  userId: apiKeys.userId,
  tier: apiKeys.tier,
  submitterId: apiKeys.submitterId,
  rateLimitRpm: apiKeys.rateLimitRpm,
  rateLimitRpd: apiKeys.rateLimitRpd,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
  revokedReason: apiKeys.revokedReason,
  lastUsedAt: apiKeys.lastUsedAt,
  lastRotatedAt: apiKeys.lastRotatedAt,
  createdAt: apiKeys.createdAt,
} as const

function withNormalizedScopes<T extends { scopes: string[] }>(rows: T[]) {
  return rows.map((row) => ({ ...row, scopes: normalizeScopes(row.scopes) }))
}

/** 未吊销且未过期。列表的 `onlyActive` 与存量上限用同一个定义。 */
const activeKey = and(
  isNull(apiKeys.revokedAt),
  or(isNull(apiKeys.expiresAt), sql`${apiKeys.expiresAt} > now()`)
)

export const apiKeysRouter = createTRPCRouter({
  // ────────────────────────────── 自助 ──────────────────────────────

  /**
   * 我自己的 key。
   *
   * `userId` 在 SQL 的 `where` 里，不在拿到行之后过滤——见 `guard.ts` 里 `listKeys`
   * 那条注释：过滤写对了，但发生在一个已经把全站 key 读进内存的查询之后，就等于没写。
   */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select(keyColumns)
      .from(apiKeys)
      .where(eq(apiKeys.userId, ctx.session.user.id))
      .orderBy(desc(apiKeys.createdAt))

    return withNormalizedScopes(rows)
  }),

  /**
   * 自助签发。明文**只**出现在这一次响应里。
   *
   * 输入 schema 里**没有** `userId`、`tier`、`rateLimitRpm`、`rateLimitRpd` —— 它们
   * 不是"被忽略"，是根本不接受。`repos.create` 早先把 `userId` 留在 schema 里然后在
   * 服务层覆盖，结果那个字段一直出现在请求体文档里，看起来像一个可配置项。
   *
   * `scopes` 的枚举是 {@link SELF_SERVICE_SCOPES} 而不是 {@link API_SCOPES}：zod 会在
   * 参数校验阶段就拒绝 `projects:write`，用户拿到的是"这个 scope 不可选"而不是
   * "自助签发不允许这些 scope"。服务层仍然再挡一次，见 `assertSelfServiceScopes`。
   */
  createMine: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        scopes: z.array(z.enum(SELF_SERVICE_SCOPES)).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await issueSelfServiceKey(ctx.db, {
        userId: ctx.session.user.id,
        name: input.name,
        scopes: input.scopes,
        emailVerified: ctx.session.user.emailVerified,
        ip: clientIpFromHeaders(ctx.headers),
      })

      if (!result.ok) {
        // `cooldown` 报 429 而不是 400：它是一个"稍后重试就会成功"的答案，而 400
        // 会让客户端的自动重试逻辑认为这是永久失败。`rate_limited_infra` 也归到
        // 429——它是"配额保护生效了"，客户端重试是对的（而且下次仍会被拒，所以不会
        // 变成一个死循环的重试风暴）。
        const tooManyRequests =
          result.code === "cooldown" || result.code === "rate_limited_infra"
        throw new TRPCError({
          code: tooManyRequests ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
          message: result.message,
        })
      }

      const issued = result.issued
      return {
        id: issued.id,
        name: issued.name,
        prefix: issued.prefix,
        scopes: issued.scopes,
        tier: issued.tier,
        createdAt: issued.createdAt,
        secret: issued.secret,
      }
    }),

  /**
   * 吊销我自己的一把 key。
   *
   * 归属检查在服务层。router 里如果只做"用户传自己的 id"，那么任何登录用户把自己的
   * id 换成别人的就能吊销别人的 key——`protectedProcedure` 不阻止这件事。
   *
   * 返回 `not_found` 而不是 `forbidden`：见 `assertKeyBelongsTo` 的注释，对一个不该
   * 看见这把 key 的人，"它不存在"比"它是别人的"少泄漏一个 id 是否有效。
   */
  revokeMine: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const owned = await assertKeyBelongsTo(
        ctx.db,
        input.id,
        ctx.session.user.id
      )
      if (!owned.ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })
      }

      const [key] = await ctx.db
        .select({ prefix: apiKeys.prefix })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1)

      // 自己吊销自己不需要理由——理由是"不想要了"，而 `revoked_reason` 里写这个没有
      // 信息量。与 admin 的 `revoke` 不同，那里"为什么"是排查泄漏的唯一线索。
      await ctx.db.transaction(async (tx) => {
        await revokeApiKey(tx, input.id, null)
        await writeApiAudit(tx, {
          userId: ctx.session.user.id,
          apiKeyId: input.id,
          keyPrefix: key?.prefix ?? "",
          action: "key.revoke",
          reason: "self-service",
          ip: clientIpFromHeaders(ctx.headers),
        })
      })

      return { id: input.id, revoked: true }
    }),

  /**
   * 轮换我自己的一把 key：新 key 的明文出现一次，旧的立即失效。
   *
   * 与 admin 的 `rotate` 唯一的区别是 `markRotated: true`——自助轮换会写
   * `last_rotated_at`，因为用户是看到"这把 key 上次轮换是 X 个月前"之后才点的这个
   * 按钮，那条记录应该指向新 key。admin 轮换是运维动作，写上去只会污染"该换了"的信号。
   *
   * scopes / 配额照搬旧 key：`rotateApiKey` 里明写了归属也要照搬，否则一把自助 key
   * 轮换之后变成无主的 service key，它的主人就再也吊销不了它了——而那正是轮换要
   * 解决的那类事故。
   */
  rotateMine: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const owned = await assertKeyBelongsTo(
        ctx.db,
        input.id,
        ctx.session.user.id
      )
      if (!owned.ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })
      }

      const [before] = await ctx.db
        .select({ prefix: apiKeys.prefix, scopes: apiKeys.scopes })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1)

      const result = await rotateApiKey(ctx.db, input.id, {
        markRotated: true,
      }).catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.message.includes("already revoked")
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message })
        }
        throw error
      })
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })
      }

      await writeApiAudit(ctx.db, {
        userId: ctx.session.user.id,
        apiKeyId: result.revokedId,
        keyPrefix: before?.prefix ?? "",
        action: "key.rotate",
        before: before ? { scopes: normalizeScopes(before.scopes) } : null,
        after: { newKeyId: result.issued.id, prefix: result.issued.prefix },
        ip: clientIpFromHeaders(ctx.headers),
      })

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

  /**
   * 放弃所有权，把这把 key 交给管理员代管。
   *
   * 存在的理由是自助配额的尖峰：一个用户可能确实需要第六、七把 key（比如一个团队共用
   * 多个 CI 环境），而"5 把"这个上限本来是为了防止批量申请，不该逼着他去申请一把
   * 永久的 service key。这个动作给了他一条出路。
   *
   * **凭据在放弃之后仍然可用**，直到 admin 决定吊销它为止 —— 这是有意的：它让"我不
   * 再需要管理这把 key 了"和"这把 key 现在就失效"成为两个不同的动作，而不是一个。
   *
   * 刻意**不提供** `updateOwner`（直接转移归属）：转移会让原主人和新宿主在同一瞬间
   * 都能吊销这把 key，而 `surrender + admin revoke` 的中间窗口里凭据状态是明确的。
   */
  surrender: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const owned = await assertKeyBelongsTo(
        ctx.db,
        input.id,
        ctx.session.user.id
      )
      if (!owned.ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })
      }

      const [key] = await ctx.db
        .select({ prefix: apiKeys.prefix })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1)

      const result = await ctx.db.transaction(async (tx) => {
        const moved = await surrenderApiKey(tx, input.id)
        if (!moved.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot surrender this key",
          })
        }
        await writeApiAudit(tx, {
          userId: ctx.session.user.id,
          apiKeyId: input.id,
          keyPrefix: key?.prefix ?? "",
          action: "key.surrender",
          before: moved.before,
          after: moved.after,
          reason: "self-service",
          ip: clientIpFromHeaders(ctx.headers),
        })
        return moved
      })

      return { id: input.id, tier: result.after.tier }
    }),

  // ────────────────────────────── 管理 ──────────────────────────────

  /**
   * 签发一把新 key。明文**只**出现在这一次响应里。
   *
   * 不设幂等键：签发不是重试安全的操作，客户端重试一次就多一把 key，而多一把无人记录
   * 的 key 恰恰是签发要避免的结果。
   *
   * `userId` 与 `tier` 是**互斥**的一对：无主只能是 service，有主只能是 user。两者
   * 都不是默认值而是要求，因为 admin 界面永远在替某一个具体的人或接入方做决定，让
   * 那个决定显式出现在输入里比让 `tier` 猜一个更可靠。
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
        // `userId: null` 明确表示"无主的接入方 key"，与"不传"不同 —— 后者会被
        // 折叠成 null，两个含义没有区别。这是一个刻意的例外：绝大多数 admin key 确实
        // 是无主的，让它必须写 `userId: null` 会让每次签发多一个无意义的字段。
        userId: z.string().min(1).nullable(),
        tier: z.enum(API_TIERS),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 提交者与归属人都必须是真实存在的账号。不在这里校验，错误就会推迟到
      // `POST /api/v1/repos` 提交时以外键违例的形式出现，而那时持有者已经拿到了
      // 一把永远用不了它的 key。
      for (const [field, value] of [
        ["submitterId", input.submitterId],
        ["userId", input.userId],
      ] as const) {
        if (!value) continue
        const [account] = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, value))
          .limit(1)
        if (!account) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No account with id ${value} (${field})`,
          })
        }
      }

      const issued = await ctx.db.transaction(async (tx) => {
        const key = await issueApiKey(tx, {
          name: input.name,
          scopes: input.scopes,
          userId: input.userId,
          tier: input.tier,
          createdBy: ctx.session.user.id,
          submitterId: input.submitterId ?? null,
          expiresAt: input.expiresAt ?? null,
          rateLimitRpm: input.rateLimitRpm,
          rateLimitRpd: input.rateLimitRpd,
        })
        await writeApiAudit(tx, {
          // admin 代签发时归属人可能是另一个人，而"谁做的"是 admin。所以审计行的
          // `user_id` 记**操作者**，key 的归属在 `after.userId` 里 —— 那才是"这把 key
          // 属于谁"。两者不能混：一个 admin 替某个用户签了一把 key，混起来之后
          // "这个用户签了哪些 key" 就再也答不出来了。
          userId: ctx.session.user.id,
          apiKeyId: key.id,
          keyPrefix: key.prefix,
          action: "key.create",
          before: null,
          after: {
            name: key.name,
            scopes: key.scopes,
            tier: key.tier,
            ownerUserId: key.userId,
          },
          reason: input.userId
            ? "issued-on-behalf-of-user"
            : "service-integration",
          ip: clientIpFromHeaders(ctx.headers),
        })
        return key
      })

      return {
        id: issued.id,
        name: issued.name,
        prefix: issued.prefix,
        scopes: issued.scopes,
        tier: issued.tier,
        userId: issued.userId,
        createdAt: issued.createdAt,
        secret: issued.secret,
      }
    }),

  /**
   * key 列表。默认带 `onlyActive`，因为那是一个管理界面最常被问的问题——
   * "现在有哪些 key 在用"。
   *
   * **不含明文，也不含 `keyHash`。** 见文件顶。
   */
  list: adminProcedure
    .input(
      z.object({
        onlyActive: z.boolean().default(true),
        createdBy: z.string().min(1).optional(),
        /** 按归属人过滤。自助打开之后这是治理页的主要视角。 */
        userId: z.string().min(1).nullable().optional(),
        tier: z.enum(API_TIERS).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = []
      if (input.onlyActive) conditions.push(activeKey)
      if (input.createdBy)
        conditions.push(eq(apiKeys.createdBy, input.createdBy))
      if (input.tier) conditions.push(eq(apiKeys.tier, input.tier))
      // `undefined` = 不过滤，`null` = 只看无主的接入方 key。两个都需要，所以用
      // `in` 之外的三态写法而不是 `if (input.userId)` —— 后者会把 null 当成"没传"。
      if (input.userId !== undefined) {
        conditions.push(
          input.userId === null
            ? isNull(apiKeys.userId)
            : eq(apiKeys.userId, input.userId)
        )
      }

      const rows = await ctx.db
        .select(keyColumns)
        .from(apiKeys)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(apiKeys.createdAt))

      return withNormalizedScopes(rows)
    }),

  /**
   * 改一把 key 的 scopes。**立即生效** —— 鉴权每次都读库，没有缓存要清，所以收窄权限
   * 不需要任何额外的失效步骤。
   *
   * 与 `updateLimits` 分成两个 mutation：配额与权限是两件事，混进一次操作会让"谁把
   * 发布权限给了这把 key"变成一个同时改了配额的 diff。
   */
  updateScopes: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        scopes: z.array(z.enum(API_SCOPES)).min(1),
        reason: revokeReason,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [key] = await ctx.db
        .select({ prefix: apiKeys.prefix })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1)
      if (!key)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })

      return ctx.db.transaction(async (tx) => {
        const updated = await updateApiKeyScopes(tx, input.id, input.scopes)
        if (!updated.ok) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })
        }
        // `changed: false` 时不写审计：一次"确认了它已经是这样"不是一次变更，而
        // 审计行是给"什么时候改了什么"用的，记入无变化的行只会在排查时制造噪声。
        if (updated.changed) {
          await writeApiAudit(tx, {
            userId: ctx.session.user.id,
            apiKeyId: input.id,
            keyPrefix: key.prefix,
            action: "scopes.update",
            before: { scopes: updated.before },
            after: { scopes: updated.after },
            reason: input.reason,
            ip: clientIpFromHeaders(ctx.headers),
          })
        }
        return updated
      })
    }),

  /**
   * 改一把 key 的配额。同样立即生效（限流计数在 Redis 里按 `key_id` 存，改配额只影响
   * 下一个请求的判定）。
   */
  updateLimits: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        rateLimitRpm: z.number().int().min(1).max(1000).optional(),
        rateLimitRpd: z.number().int().min(1).max(1_000_000).optional(),
        reason: revokeReason,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [key] = await ctx.db
        .select({ prefix: apiKeys.prefix })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1)
      if (!key)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })

      return ctx.db.transaction(async (tx) => {
        const updated = await updateApiKeyLimits(tx, input.id, {
          rateLimitRpm: input.rateLimitRpm,
          rateLimitRpd: input.rateLimitRpd,
        })
        if (!updated.ok) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })
        }
        if (updated.changed) {
          await writeApiAudit(tx, {
            userId: ctx.session.user.id,
            apiKeyId: input.id,
            keyPrefix: key.prefix,
            action: "limits.update",
            before: updated.before,
            after: updated.after,
            reason: input.reason,
            ip: clientIpFromHeaders(ctx.headers),
          })
        }
        return updated
      })
    }),

  /**
   * 吊销。立即生效。
   *
   * `reason` 必填（见 {@link revokeReason}）。对已吊销的 key 再吊销一次不报错：第二个
   * 理由被忽略，这让"重复点一次确认"是安全的，而返回一个错误只会让人怀疑第一次是否
   * 真的生效了。
   */
  revoke: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        reason: revokeReason,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [key] = await ctx.db
        .select({ prefix: apiKeys.prefix })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1)
      if (!key)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })

      return ctx.db.transaction(async (tx) => {
        const revoked = await revokeApiKey(tx, input.id, input.reason)
        // 同样跳过无变化的吊销：审计要回答的是"这把 key 什么时候、为什么失效"。
        if (revoked) {
          await writeApiAudit(tx, {
            userId: ctx.session.user.id,
            apiKeyId: input.id,
            keyPrefix: key.prefix,
            action: "key.revoke",
            reason: input.reason,
            ip: clientIpFromHeaders(ctx.headers),
          })
        }
        return { id: input.id, revoked }
      })
    }),

  /**
   * 轮换：吊销旧的 + 签发新的，同一个事务。旧的**立即**失效。
   *
   * `markRotated` 留默认（`false`）：admin 轮换是运维动作，写 `last_rotated_at` 只会
   * 污染用户看到的"这把该换了"的信号。
   *
   * 对已吊销的 key 轮换会报错：那几乎总是调用方的状态没刷新，而默默接受会留下一条比
   * 原始吊销更晚的吊销记录，读起来像"恢复过"。
   */
  rotate: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [before] = await ctx.db
        .select({ prefix: apiKeys.prefix, scopes: apiKeys.scopes })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1)
      if (!before)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })

      const result = await rotateApiKey(ctx.db, input.id).catch(
        (error: unknown) => {
          if (
            error instanceof Error &&
            error.message.includes("already revoked")
          ) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message })
          }
          throw error
        }
      )
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such API key" })
      }

      await writeApiAudit(ctx.db, {
        userId: ctx.session.user.id,
        apiKeyId: result.revokedId,
        keyPrefix: before.prefix,
        action: "key.rotate",
        before: { scopes: normalizeScopes(before.scopes) },
        after: { newKeyId: result.issued.id, prefix: result.issued.prefix },
        ip: clientIpFromHeaders(ctx.headers),
      })

      return {
        revokedId: result.revokedId,
        issued: {
          id: result.issued.id,
          name: result.issued.name,
          prefix: result.issued.prefix,
          scopes: result.issued.scopes,
          tier: result.issued.tier,
          userId: result.issued.userId,
          createdAt: result.issued.createdAt,
          secret: result.issued.secret,
        },
      }
    }),

  /**
   * 审计日志。
   *
   * **这是"admin 改过谁的权限"第一次可以回答**（§2.1 第二条）。`api_keys` 只记录
   * 当前状态：`updateScopes` 是就地覆盖，`scopes` 里看不出昨天是什么。
   *
   * 按 owner 查（`userId`）与按 key 查（`apiKeyId`）是两种排查方向，所以两个都支持；
   * 前者对应索引 `api_request_audit_user_id_created_at_idx`，后者对应
   * `api_request_audit_api_key_id_idx`。不限 owner 时不加 `where` —— 这不是常用路径，
   * 所以没有为它建索引，也不该在治理页的默认视图里用。
   */
  audit: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1).optional(),
        apiKeyId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = []
      if (input.userId)
        conditions.push(eq(apiRequestAudit.userId, input.userId))
      if (input.apiKeyId)
        conditions.push(eq(apiRequestAudit.apiKeyId, input.apiKeyId))

      return ctx.db
        .select({
          id: apiRequestAudit.id,
          userId: apiRequestAudit.userId,
          apiKeyId: apiRequestAudit.apiKeyId,
          keyPrefix: apiRequestAudit.keyPrefix,
          action: apiRequestAudit.action,
          before: apiRequestAudit.before,
          after: apiRequestAudit.after,
          reason: apiRequestAudit.reason,
          ip: apiRequestAudit.ip,
          createdAt: apiRequestAudit.createdAt,
        })
        .from(apiRequestAudit)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(apiRequestAudit.createdAt))
        .limit(input.limit)
    }),

  /**
   * 配额档位的默认值，供治理页的表单显示"当前档位意味着什么"。
   *
   * 一个查询而不是让前端 import 常量：tRPC 的响应会被 superjson 处理、并且能加上缓存
   * 与校验，而一个客户端自己 import 的常量没有任何这些。代价是多一次往返。
   */
  tierDefaults: adminProcedure.query(() => TIER_DEFAULTS),
})

/** 供自助页面渲染"哪些 scope 可选"时做类型收窄。 */
export type SelfServiceScope = (typeof SELF_SERVICE_SCOPES)[number]
export type { ApiScope, ApiTier }
