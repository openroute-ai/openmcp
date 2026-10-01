import { and, desc, eq, inArray, sql } from "drizzle-orm"

import { projects, repos, user, userRepos } from "@/db/schema"
import type {
  PlatformRepoStatus,
  UserRepoRow,
  UserRepoStatus,
} from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"

type UserRepoInsert = typeof userRepos.$inferInsert

/**
 * How a submission entered the system. Public: everyone who submitted it sees it.
 *
 * Taken from the *row* type rather than the insert type: every column on this
 * table is `notNull`, but an insert type marks a defaulted column optional, so
 * `$inferInsert` widens `source` and `status` to `| undefined`. That would force
 * every reader of a submission to handle a value the database cannot produce.
 */
export type UserRepoSource = (typeof userRepos.$inferSelect)["source"]

/**
 * 平台状态的判定式，直接写在 `repos` 与 `projects` 上。
 *
 * 抽成 `sql` 片段而不是在 JS 里判断，是因为它要用在两个地方：写这一列时（把
 * 物化的值刷新成当前值），以及任何不想依赖这一列的地方。这个片段是唯一的判定
 * 处，两处共用它，所以物化值与真实值不可能有第二种算法上的分歧。
 *
 * 优先级是"最远走到哪一步"，而不是互斥开关：一个已归档的仓库同时也是已发布的
 * 时，报 `archived`——GitHub 不会再动它，发布与否已经不会让它复活。
 */
const platformStatusCase = sql<PlatformRepoStatus>`
  case
    when ${repos.archived} is true then 'archived'
    when exists (select 1 from ${projects} p where p.repo_id = ${repos.id}) then 'curated'
    else 'tracked'
  end
`

/**
 * Records that a user submitted a repository.
 *
 * **幂等**，且幂等的方向是刻意的：重复提交**不**会覆盖用户自己的处置。一份提交
 * 的存在与它的来源是公开事实，重复提交只是把同一件公开的事又说了一遍；而
 * `status` / `note` / `pinned` 是这个用户私下对它的处置，被一次"我又粘贴了一次
 * 同样的 URL"抹掉是不能接受的。所以冲突时只补 `submitted_at`——它本来就是
 * 第一次提交的时间，而 `created_at` 已经是那个值了，所以连它都不用动。
 *
 * 换句话说：这一行**记录**一次提交，不**反映**最近一次提交。前者是"谁提交过
 * 它"，后者是"他刚刚做了什么"，而只有前者是这一行存在的理由。
 */
export async function linkUserToRepo(
  db: Db,
  input: {
    userId: string
    repoId: string
    source?: UserRepoSource
    submittedAt?: Date
  }
): Promise<void> {
  await db
    .insert(userRepos)
    .values({
      userId: input.userId,
      repoId: input.repoId,
      source: input.source ?? "console",
      ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
    })
    .onConflictDoNothing()
}

/**
 * Refreshes the materialised platform state of every row for these repositories.
 *
 * 写的是公共列，所以它跟着仓库走而不是跟着用户走：一个仓库的十行必须给出同一个
 * 答案，否则"同一个仓库在 A 的页面上已发布、在 B 的页面上只是跟踪中"就成了
 * 可能，而这句话本身就是错的。
 *
 * 传空数组直接返回而不是发一条 `in ()` 的查询——drizzle 会把它变成永假条件，
 * 结果正确但多一次往返；调用点在批量路径上，空批次是常态而不是异常。
 *
 * `repos` 必须出现在 `FROM` 里：判定式读的是 `repos.archived`，而 UPDATE 的
 * `SET` 里引用一张不在 `FROM` 的表，Postgres 直接报 `missing FROM-clause entry`。
 * 所以这次写是 `update ... from repos`，`where` 里那句 `repos.id = repo_id` 不是
 * 过滤条件而是连接条件——少了它，这条语句会把 `user_repos` 与整张 `repos` 笛卡尔
 * 相乘，取到的那一行是任意的。`platform_synced_at` 也因此直接读 `repos.updated_at`，
 * 不再需要子查询。
 */
export async function recomputePlatformStates(
  db: Db,
  repoIds: readonly string[]
): Promise<void> {
  const ids = [...new Set(repoIds)].filter(Boolean)
  if (ids.length === 0) return

  await db
    .update(userRepos)
    .set({
      platformStatus: platformStatusCase,
      platformSyncedAt: sql`${repos.updatedAt}`,
    })
    .from(repos)
    .where(and(inArray(userRepos.repoId, ids), eq(repos.id, userRepos.repoId)))
}

/**
 * 把一个用户对某份提交的处置改成他给的新值。
 *
 * 只碰私有列，也只作用于这一对关系——条件里带上了 `user_id`，所以即使调用方
 * 传了一个别人的 `userId`，那也不是"越权写成功"，而是"写不到那一行"之后返回
 * `false`。返回布尔而不是抛错，是因为调用方要区分"没有这一行"和"写了"，而这两
 * 种情况在界面上都只是"没改成"。
 *
 * 未传（`undefined`）的字段保持不变，所以这是一次局部写而不是整行替换；显式传
 * `null` 则清空该字段。
 */
export async function updateUserRepo(
  db: Db,
  input: {
    userId: string
    repoId: string
    status?: UserRepoStatus
    note?: string | null
    pinned?: boolean
    lastViewedAt?: Date | null
  }
): Promise<boolean> {
  const fields: Partial<UserRepoInsert> = {}
  if (input.status !== undefined) fields.status = input.status
  if (input.note !== undefined) fields.note = input.note
  if (input.pinned !== undefined) fields.pinned = input.pinned
  if (input.lastViewedAt !== undefined) fields.lastViewedAt = input.lastViewedAt

  if (Object.keys(fields).length === 0) {
    // A call with nothing to write is a no-op, not an empty UPDATE. Returning
    // early keeps `updated_at` meaning what its column comment says: the last
    // time the *user* changed something.
    return true
  }

  // Bumped here rather than in a column default: `$onUpdate` fires on any write,
  // and the platform's writes to `platform_*` must not count as this user's edit.
  const rows = await db
    .update(userRepos)
    .set({ ...fields, updatedAt: new Date() })
    .where(
      and(
        eq(userRepos.userId, input.userId),
        eq(userRepos.repoId, input.repoId)
      )
    )
    .returning({ repoId: userRepos.repoId })

  return rows.length > 0
}

/** One row with the repository it points at, for a list of a user's submissions. */
export interface UserRepoWithRepo extends UserRepoRow {
  repo: {
    id: string
    owner: string
    name: string
    description: string | null
    descriptionZh: string | null
    iconUrl: string | null
    stars: number | null
    archived: boolean | null
    pushedAt: Date
    addedAt: Date
    updatedAt: Date | null
    projectCount: number
  }
}

/**
 * 一个用户提交过的所有仓库，最新的在前。
 *
 * 与仓库信息一起返回而不是分两次查：这个列表的价值在于"我提交过的每一份现在
 * 怎么样了"，而那个答案横跨两张表，所以一次查询把它算出来比让界面拼两次结果更
 * 少一次往返，也少一处"两个数字来自两次不同查询"的可能。
 *
 * `projectCount` 是仓库级的公共事实——它回答的是"平台有没有把它做成项目"，而
 * 那是所有人都能看到的问题，不随看的人而变。
 */
export async function listUserRepos(
  db: Db,
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ items: UserRepoWithRepo[]; total: number }> {
  const { limit = 50, offset = 0 } = options

  const [rows, counted] = await Promise.all([
    db
      .select({
        row: userRepos,
        repo: {
          id: repos.id,
          owner: repos.owner,
          name: repos.name,
          description: repos.description,
          descriptionZh: repos.descriptionZh,
          iconUrl: repos.iconUrl,
          stars: repos.stars,
          archived: repos.archived,
          pushedAt: repos.pushedAt,
          addedAt: repos.addedAt,
          updatedAt: repos.updatedAt,
          projectCount: sql<number>`(
            select count(*)::int from ${projects}
            where ${projects.repoId} = ${repos.id}
          )`,
        },
      })
      .from(userRepos)
      .innerJoin(repos, eq(repos.id, userRepos.repoId))
      .where(eq(userRepos.userId, userId))
      // Newest submission first: the most recent thing someone submitted is the
      // one they came to look at, and `submitted_at` is the only timestamp that
      // answers "when did they submit this" rather than "when did it change".
      .orderBy(desc(userRepos.submittedAt), desc(repos.name))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(userRepos)
      .where(eq(userRepos.userId, userId)),
  ])

  return {
    items: rows.map((row) => ({ ...row.row, repo: row.repo })),
    total: counted[0]?.value ?? 0,
  }
}

/** How many users have submitted a repository, and whether one of them is `userId`. */
export async function countRepoSubmitters(
  db: Db,
  repoId: string
): Promise<{ total: number }> {
  const [counted] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(userRepos)
    .where(eq(userRepos.repoId, repoId))
  return { total: counted?.value ?? 0 }
}

/**
 * 读一个用户对某个仓库的那一行——**只读他本人的**。
 *
 * `userId` 不是可选参数，也没有"管理员读别人"的分支：这个函数的用途就是"把
 * 当前调用者的这一行取出来"，把它做成能传别人的 id，等于给了一段会泄露 `note`
 * 的代码留一个以后有人会去用的开关。管理员要看别人的行，走
 * {@link listRepoSubmitters}，那是另一个函数、另一条授权路径。
 */
export async function getUserRepo(
  db: Db,
  userId: string,
  repoId: string
): Promise<UserRepoRow | undefined> {
  // Written as an explicit select rather than `db.query.userRepos`: the
  // relational helper only exists for tables whose `relations` are in the object
  // handed to `drizzle()`, and `src/db/schema.ts` keeps its own relations out of
  // that object on purpose (better-auth reads it). A missing helper fails at the
  // type level; a missing column fails at runtime, which is the one kind of
  // mistake this schema has been bitten by before.
  const [row] = await db
    .select()
    .from(userRepos)
    .where(and(eq(userRepos.userId, userId), eq(userRepos.repoId, repoId)))
    .limit(1)
  return row
}

/** One submission row with the account that made it, for the operator console. */
export interface RepoSubmitter {
  userId: string
  name: string
  email: string
  phoneNumber: string | null
  image: string | null
  role: string | null
  source: UserRepoSource
  submittedAt: Date
  status: UserRepoStatus
  note: string | null
  pinned: boolean
  lastViewedAt: Date | null
  updatedAt: Date
}

/**
 * 谁提交过这个仓库。
 *
 * 只有 `adminProcedure` 会调它——这正是"看不到各自更新"的那一半：非管理员根本
 * 不在这条路径上，所以别人的 `note` 不是被界面藏起来，而是没有查询能把它取出来。
 *
 * 需要 `user` 的显示字段（姓名、邮箱）而不是只返回 `user_id`：这张列表的唯一
 * 用途就是判断"这是不是同一个人又提交了一次"，而一列 id 回答不了这个问题。
 */
export async function listRepoSubmitters(
  db: Db,
  repoId: string
): Promise<RepoSubmitter[]> {
  return db
    .select({
      userId: userRepos.userId,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      image: user.image,
      role: user.role,
      source: userRepos.source,
      submittedAt: userRepos.submittedAt,
      status: userRepos.status,
      note: userRepos.note,
      pinned: userRepos.pinned,
      lastViewedAt: userRepos.lastViewedAt,
      updatedAt: userRepos.updatedAt,
    })
    .from(userRepos)
    .innerJoin(user, eq(user.id, userRepos.userId))
    .where(eq(userRepos.repoId, repoId))
    .orderBy(desc(userRepos.submittedAt), user.name)
}
