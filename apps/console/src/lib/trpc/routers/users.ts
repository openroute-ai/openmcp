import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { account as authAccount, session, user, userRepos } from "@/db/schema"
import { isAdmin } from "@/lib/auth/role"
import { listUserRepos } from "@/lib/github/service/user-repo"
import { createTRPCRouter, adminProcedure } from "../init"

/** Rows per page. An account directory is scanned, not read end to end. */
const PAGE_SIZE = 20

/**
 * 账号管理。
 *
 * 这一层以前不存在：`/dashboard` 的每个页面都在讲**内容**（仓库、项目、技能、
 * 任务），没有一个页面能回答"这是谁"以及"他现在还在线吗"。作者（`hall_of_fame`）
 * 不是同一个东西——那是 GitHub 上的项目归属人，与本站的登录账号之间没有
 * 关系，回答不了"这个账号提交过什么"。
 *
 * 全部是 `adminProcedure`。列出会暴露每一个账号的邮箱与手机号，而这个接口不
 * 给非管理员任何一种部分视图：账号列表没有"我的"版本，它的全部价值就在于它是
 * 全量的。
 */
export const usersRouter = createTRPCRouter({
  /**
   * 账号目录。
   *
   * 按注册时间倒序，而不是按名字：一个账号名下的提交量和会话数比它的名字更能说明
   * 它的重要性，而这两个数字只有排序之后才看得出来。
   *
   * 搜索匹配姓名、邮箱与手机号三项，因为这三项正是运营真正收到的那一项——用户
   * 报障时给的是邮箱或手机号，不会给一个内部 id。
   */
  list: adminProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        role: z.enum(["all", "admin", "user"]).default("all"),
        banned: z.enum(["all", "banned", "active"]).default("all"),
        limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQL[] = []

      const term = input.search?.trim()
      if (term) {
        // Escaped for the same reason `repos.list` escapes it: an unescaped `%`
        // turns a search for "a+b" into a pattern that matches the whole table.
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`
        conditions.push(
          or(
            ilike(user.name, pattern),
            ilike(user.email, pattern),
            ilike(user.phoneNumber, pattern)
          )!
        )
      }

      // `role` is nullable in the schema and null means "an ordinary account",
      // so filtering for the `user` role has to match the null too. Matching
      // only the literal string would silently hide every account created
      // before the column had a default.
      if (input.role === "admin") {
        conditions.push(eq(user.role, "admin"))
      } else if (input.role === "user") {
        conditions.push(
          or(eq(user.role, "user"), sql`${user.role} is null`)!
        )
      }

      if (input.banned === "banned") {
        conditions.push(eq(user.banned, true))
      } else if (input.banned === "active") {
        conditions.push(sql`${user.banned} is not true`)
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [rows, counted] = await Promise.all([
        ctx.db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            phoneNumber: user.phoneNumber,
            phoneNumberVerified: user.phoneNumberVerified,
            image: user.image,
            role: user.role,
            banned: user.banned,
            banReason: user.banReason,
            banExpires: user.banExpires,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            // Both counts are subqueries rather than joins so an account with
            // three sessions and two providers is still one row, and the totals
            // on this page are totals of *accounts* — the same reason
            // `repos.list` writes its project count as NOT EXISTS.
            sessionCount: sql<number>`(
              select count(*)::int from ${session}
              where ${session.userId} = ${user.id}
            )`,
            repoCount: sql<number>`(
              select count(*)::int from ${userRepos}
              where ${userRepos.userId} = ${user.id}
            )`,
          })
          .from(user)
          .where(where)
          .orderBy(desc(user.createdAt), user.name)
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: count() })
          .from(user)
          .where(where)
          .then((rows) => rows[0]),
      ])

      return {
        items: rows.map((row) => ({ ...row, isAdmin: isAdmin(row) })),
        total: Number(counted?.value ?? 0),
      }
    }),

  /**
   * 一个账号的全部关联信息。
   *
   * 三块一起返回，因为它们互为解释：一次会话说明"他现在还在线吗"，一条提交说明
   * "他为什么会有这个账号"，一列登录方式说明"他是怎么进来的"。分开取要三次
   * 往返，而且会出现"会话表说有两条、用户表说一条活跃"这种两次查询之间的窗口。
   *
   * 提交的列表由 `listUserRepos` 提供，它把公开列（提交时间、平台状态）和私有列
   * （备注、置顶、最近查看）放在同一行——**对这个账号而言**这两半都是可以读的，
   * 因为管理员本来就能在任何地方看到它们，分开取只会让人以为有区别。
   */
  byId: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [profile] = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          phoneNumber: user.phoneNumber,
          phoneNumberVerified: user.phoneNumberVerified,
          image: user.image,
          role: user.role,
          banned: user.banned,
          banReason: user.banReason,
          banExpires: user.banExpires,
          customerId: user.customerId,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .from(user)
        .where(eq(user.id, input.id))
        .limit(1)

      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" })
      }

      const [sessions, providers, submissions] = await Promise.all([
        ctx.db
          .select({
            id: session.id,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            expiresAt: session.expiresAt,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
          })
          .from(session)
          .where(eq(session.userId, input.id))
          // Newest first, and the page reads the top of the list as "where this
          // person is right now" — an expired session at the top would make that
          // reading wrong.
          .orderBy(desc(session.createdAt)),
        ctx.db
          .select({
            id: authAccount.id,
            providerId: authAccount.providerId,
            accountId: authAccount.accountId,
            // Whether a credential exists, never what it is. The column holds a
            // password hash or an OAuth token and this page has no use for
            // either, so the boolean is the whole of what leaves the server.
            hasPassword: sql<boolean>`${authAccount.password} is not null`,
            createdAt: authAccount.createdAt,
            updatedAt: authAccount.updatedAt,
          })
          .from(authAccount)
          .where(eq(authAccount.userId, input.id))
          .orderBy(desc(authAccount.createdAt)),
        listUserRepos(ctx.db, input.id, { limit: 200 }),
      ])

      const now = new Date()

      return {
        ...profile,
        isAdmin: isAdmin(profile),
        sessions: sessions.map((row) => ({
          ...row,
          // Derived here rather than in the component: "expired" is a comparison
          // against the server's clock, and the browser's clock is not the one
          // that decides whether this token still works.
          expired: row.expiresAt <= now,
        })),
        accounts: providers,
        // Flattened, with the count beside it. The count is not derivable from
        // the array, because the array is capped — a submission past the cap is
        // omitted, not absent, and a page that showed "8 submissions" from an
        // 8-row list would claim the account has exactly eight when it has more.
        submissions: submissions.items,
        submissionTotal: submissions.total,
      }
    }),

  /**
   * 改一个账号的平台角色。
   *
   * 只有这一列可写，其余字段由认证流程拥有：邮箱经过验证状态、手机号经过验证码、
   * 封禁三列由 better-auth 的 admin plugin 读写。一条能写任意列的接口，迟早会
   * 有人用它去改 `email_verified`。
   *
   * 拒绝把自己降级。看到自己即将失去的唯一一条管理员路径时，那通常是一个误操作，
   * 而把它做掉之后唯一的管理员就再也回不来了——`src/db/role.ts` 之外的恢复路径
   * 不存在。让另一个人来做这件事，一次点击就够了。
   */
  setRole: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        role: z.enum(["admin", "user"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.session.user.id && input.role !== "admin") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "users.setRole.selfDemotion",
        })
      }

      const [updated] = await ctx.db
        .update(user)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(user.id, input.id))
        .returning({ id: user.id, name: user.name, role: user.role })

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" })
      }

      return updated
    }),
})