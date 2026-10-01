import { and, count, desc, eq, gt, ilike, lt, or, sql, type SQL } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { session, user, userRepos } from "@/db/schema"
import { createTRPCRouter, adminProcedure } from "../init"

/** Rows per page, matching the other operator logs. */
const PAGE_SIZE = 20

/**
 * 会话管理。
 *
 * `session` 表一直存在、一直被读——每一个受保护的页面都拿它鉴权——但没有人能看
 * 到它。签入的用户不知道自己有多少个会话在有效，看不见从哪个 IP、哪个浏览器登
 * 录过；运营也无法回答"这个账号现在在线吗"。
 *
 * 全部 `adminProcedure`：一行会话带着 IP 与 User-Agent，那是一条可以定位到人的
 * 记录，比账号列表本身更敏感。
 */
export const sessionsRouter = createTRPCRouter({
  /**
   * 会话列表，按最近使用排序。
   *
   * 按 `created_at` 而不是 `updated_at`：better-auth 的 `session.updated_at` 是
   * 带 `$onUpdate` 的，而每次带 cookie 的请求都不会真正改写这一行（没有会话就
   * 没有新会话），所以用它排序得到的顺序看起来像随机。`expires_at` 的过滤放在
   * 查询里而不是界面上，因为"还有多少个活跃会话"是这张列表最常被问的问题，而
   * 把它做成一个可以顺手就切走的筛选，恰好让那个问题变得需要点两下。
   */
  list: adminProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        state: z.enum(["active", "expired", "all"]).default("active"),
        userId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQL[] = []
      const now = new Date()

      if (input.state === "active") {
        conditions.push(gt(session.expiresAt, now))
      } else if (input.state === "expired") {
        conditions.push(lt(session.expiresAt, now))
      }

      if (input.userId) {
        conditions.push(eq(session.userId, input.userId))
      }

      const term = input.search?.trim()
      if (term) {
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`
        conditions.push(
          or(
            ilike(user.email, pattern),
            ilike(user.name, pattern),
            ilike(user.phoneNumber, pattern),
            ilike(session.ipAddress, pattern),
            ilike(session.userAgent, pattern)
          )!
        )
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [rows, counted] = await Promise.all([
        ctx.db
          .select({
            id: session.id,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            expiresAt: session.expiresAt,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              phoneNumber: user.phoneNumber,
              image: user.image,
              role: user.role,
            },
          })
          .from(session)
          .innerJoin(user, eq(user.id, session.userId))
          .where(where)
          .orderBy(desc(session.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: count() })
          .from(session)
          .innerJoin(user, eq(user.id, session.userId))
          .where(where)
          .then((rows) => rows[0]),
      ])

      return {
        items: rows.map((row) => ({ ...row, expired: row.expiresAt <= now })),
        total: Number(counted?.value ?? 0),
      }
    }),

  /**
   * 一条会话，加上它所属的账号在其它地方的活动。
   *
   * "同一个人还在别处登录吗"是会话详情页存在的唯一理由，而这个答案不能靠列表里
   * 那一行回答——同一账号的其它会话在另一个分页里。所以这里取该账号的**全部**
   * 会话并标出当前这一条，页面于是能在一屏之内说清"这是他第几个会话、还有几个"。
   *
   * 顺带把这个账号的提交数量也带回来：一条会话和一份提交放在一起读，比一个
   * "会话总数"标签有用得多，而它已经在同一层连接里了。
   */
  byId: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          expiresAt: session.expiresAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          // Declared, unused, and never read: see `src/db/schema.ts`. Selected
          // here only so the shape of the row matches what a reader expects from
          // a session table, not because anything acts on it.
          activeOrganizationId: session.activeOrganizationId,
          impersonatedBy: session.impersonatedBy,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            phoneNumber: user.phoneNumber,
            image: user.image,
            role: user.role,
            banned: user.banned,
            createdAt: user.createdAt,
            repoCount: sql<number>`(
              select count(*)::int from ${userRepos}
              where ${userRepos.userId} = ${user.id}
            )`,
          },
        })
        .from(session)
        .innerJoin(user, eq(user.id, session.userId))
        .where(eq(session.id, input.id))
        .limit(1)

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }

      const siblings = await ctx.db
        .select({
          id: session.id,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          ipAddress: session.ipAddress,
        })
        .from(session)
        .where(eq(session.userId, row.user.id))
        .orderBy(desc(session.createdAt))

      const now = new Date()

      return {
        ...row,
        expired: row.expiresAt <= now,
        siblings: siblings.map((sibling) => ({
          ...sibling,
          expired: sibling.expiresAt <= now,
        })),
      }
    }),

  /**
   * 吊销一条会话。
   *
   * 删行而不是写一个 `revoked_at`：`session` 没有那一列，而 better-auth 每次
   * 请求都按 token 查这张表，所以删掉就是立刻生效——这也是账号被盗时唯一有用的
   * 时机，那时"要不要留个审计记录"是次要的。
   *
   * 可以一次收掉这个账号的全部会话。这不是"批量删除"的多余写法：账号被盗的
   * 处置动作几乎总是"全部登出"，而一次只能踢掉一个会话的管理界面会让人误以为
   * 已经处理完了。
   */
  revoke: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        /** Revoke every session of the same account, not just this one. */
        allForUser: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db
        .select({ id: session.id, userId: session.userId })
        .from(session)
        .where(eq(session.id, input.id))
        .limit(1)

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }

      const scope = input.allForUser
        ? eq(session.userId, target.userId)
        : eq(session.id, target.id)

      const deleted = await ctx.db
        .delete(session)
        .where(scope)
        .returning({ id: session.id })

      return {
        id: input.id,
        userId: target.userId,
        allForUser: input.allForUser,
        // What was actually removed, not what was asked for: "revoke all" on an
        // account whose other session had just expired legitimately removes one
        // row, and reporting three would be a lie the operator cannot detect.
        revoked: deleted.map((row) => row.id),
        // The same number, for callers that have something to say about a count
        // rather than about a set of ids. Both rather than only one, because the
        // ids are how a caller invalidates the rows it just deleted and the count
        // is how a toast reports them — and picking one would force the other
        // caller to reach through it.
        revokedCount: deleted.length,
      }
    }),
})