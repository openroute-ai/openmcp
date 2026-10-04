/**
 * 服务层的归属与授权判断。
 *
 * **为什么这个文件存在**：现有 `lib/api/keys.ts` 里的
 * `issueApiKey` / `rotateApiKey` / `revokeApiKey` / `findApiKeyByPlaintext`
 * 一行授权判断都没有，唯一的一道门在 router 里。那是 admin-only 时代留下的形状
 * —— `adminProcedure` 之后还要什么？把 `apiKeys.createMine` 写成
 * `protectedProcedure` 会直接踩到它：任何登录用户都能给自己签发任意 scopes 和
 * 无限额。
 *
 * 所以判断放在这里，而不是散在两个 router 的输入 schema 里。理由是两条路径的
 * 形状不同、但**要挡的东西一样**：`createMine` 与 `create` 的输入字段几乎一致
 * （同一个 zod 对象），而它们唯一的区别就是"能不能指定主人"和"scope 能不能超出
 * 子集"。把这个区别写成两个 router 里各一份 `if`，下一次有人加一个 mutation
 * 就会以为"前面已经检查过了"。
 *
 * 每个断言的形状都是 `{ ok: false, ... } | { ok: true, ... }` 而不是 `throw`，
 * 因为调用方要把失败翻译成用户能看懂的话（"这把 scope 超出自助范围"），
 * 而异常消息在 tRPC 的错误体里还要再过一次 `errorFormatter` 才能到界面上。
 */
import { and, eq } from "drizzle-orm"
import type { db as Db } from "@/db/client"
import { apiKeys } from "@/db/schema/api-keys"
import { user } from "@/db/schema"
import { activeApiKeysFilter, normalizeScopes } from "./keys"
import {
  assertScopesSubset,
  assertTierMatchesOwner,
  isSelfServiceScope,
  SELF_SERVICE_SCOPES,
  TIER_DEFAULTS,
  type ApiScope,
  type ApiTier,
} from "./scopes"

type Database = typeof Db

/**
 * 只要能 `select` 就够。
 *
 * 这个文件的每个读取函数都要能在事务里跑 —— {@link assertKeyCountWithinLimit}
 * 尤其如此：它的 `.for("update")` 只有在和插入同一个事务里才真的锁得住东西，所以
 * "它接受一个事务"不是方便，是正确性的前提。
 */
type ApiKeyReader = Pick<Database, "select">

/**
 * 授权失败。
 *
 * 一个专属类型而不是裸 `Error`，因为调用方需要区分"这是授权问题"和"数据库炸了"：
 * 前者变成一个 403/400，后者必须冒泡成 500，否则一次数据库抖动会被报成"你没有
 * 权限"，而那会把排障引向完全错误的方向。
 */
export class ApiKeyOwnershipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ApiKeyOwnershipError"
  }
}

/**
 * 自助签发的 scope 必须是 {@link SELF_SERVICE_SCOPES} 的子集。
 *
 * 服务层强制，不信任 router 传进来的值 —— router 那边已经过滤过一次，这里是第二
 * 道，因为将来任何一个新调用方都会在 router 里看到那个 `SELF_SERVICE_SCOPES`
 * 引用，而"看起来已经检查过了"正是它会被跳过的原因。
 */
export function assertSelfServiceScopes(scopes: readonly ApiScope[]): void {
  const result = assertScopesSubset(scopes, SELF_SERVICE_SCOPES)
  if (!result.ok) {
    throw new ApiKeyOwnershipError(
      `自助签发不允许这些 scope：${result.rejected.join(", ")}。可勾选的是 ${SELF_SERVICE_SCOPES.join(", ")}`
    )
  }
}

/** 每个不合法 scope 配一句"为什么不给你"，界面直接显示。 */
export function explainSelfServiceScope(scope: string): string | null {
  if (isSelfServiceScope(scope)) return null
  switch (scope) {
    case "projects:write":
      return "发布项目是运营动作，需要管理员开通"
    case "subscriptions:write":
      return "订阅投递可以指定任意回调地址，需要管理员开通"
    default:
      return "未知 scope"
  }
}

/**
 * `tier` 与 `userId` 的形状约束。
 *
 * §2.2：`tier === "service"` ⟺ `user_id IS NULL`。有主人 ⇒ user，无主人 ⇒
 * service，反过来同样成立。
 */
export function assertTierShape(tier: ApiTier, userId: string | null): void {
  const result = assertTierMatchesOwner(tier, userId)
  if (!result.ok) throw new ApiKeyOwnershipError(result.message)
}

/**
 * 这把 key 是不是这个人的。
 *
 * 自助入口（`revokeMine` / `rotateMine` / `surrender`）**必须**经过它，
 * 而且必须传具体的 keyId —— "只能操作我自己的"如果只体现在"我传一个我自己的 id
 * 上去"，那它其实什么都没保证：任何一个登录用户把自己的 id 换成别人的 id 调用，
 * router 没有任何东西会拦。
 *
 * 返回 `not_found` 而不是 `forbidden` 是刻意的：对一个不该看见这把 key 的人，
 * 回答"它不存在"比回答"它是别人的"少泄漏一个 id 是否有效，而调用方在两种情况下
 * 都不能做任何事，所以少说的那点信息买不到任何东西。
 */
export async function assertKeyBelongsTo(
  db: ApiKeyReader,
  keyId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "revoked" }> {
  const [row] = await db
    .select({ userId: apiKeys.userId, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1)

  // `userId` 不匹配与"不存在"返回同一个结果，见上面的注释。
  if (!row || row.userId !== userId) return { ok: false, reason: "not_found" }
  if (row.revokedAt) return { ok: false, reason: "revoked" }
  return { ok: true }
}

/** 同一个账号未吊销的 key 上限。 */
export const MAX_SELF_SERVICE_KEYS = 5

/**
 * 存量上限的判断。**必须在插入的同一事务里调用**，否则"先 count 再 insert"是一个
 * TOCTOU：两个并发请求都能读到 4 把自己就都通过。
 *
 * ## 锁 `user` 行，不锁 `api_keys` 行
 *
 * 锁的目标是**把这个用户的所有签发串起来**，而不是锁住它已有的那几把 key。锁
 * `api_keys` 里 `user_id = ?` 的行做不到这件事——在存量 0 时它锁不到任何行，两个并发
 * 请求于是各自锁了个空；而在存量 ≥ 1 时它只挡住"同时改同几把"，挡不住"两个人各自在
 * 自己的读数上 +1"。
 *
 * 锁 `user` 行则有且只有一行、**永远存在**，所以零存量时也一样把两个请求串起来。
 *
 * `SELECT ... FOR UPDATE` 用在带 `count(*)` 的查询上会被 Postgres 拒绝
 * （`FOR UPDATE is not allowed with aggregate functions`），所以这里锁完再数：一次
 * 查询、一把锁，代价是搬几行 id 而不是搬一个整数——而每个用户本来就被这个上限
 * 限制在个位数。
 */
export async function assertKeyCountWithinLimit(
  db: ApiKeyReader,
  userId: string,
  limit: number = MAX_SELF_SERVICE_KEYS
): Promise<{ ok: true } | { ok: false; count: number; limit: number }> {
  // 第一步：拿这个用户的行锁。它在两次签发之间制造了一个串行点，所以第二次那个
  // 请求的 count 一定看到第一次的插入结果。
  await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update")

  // 锁到了用户行说明用户存在；一个 session 指向一个不存在的用户不可能发生，所以
  // 这里不区分"没有行"和"锁住了"——锁不到行时 count 自然是 0，而那会让一次伪造的
  // userId 拿到 5 把没有主人的 key。交给下面 0022 的 CHECK 去拒绝那种行。
  const rows = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), activeApiKeysFilter()))

  const count = rows.length
  if (count >= limit) return { ok: false, count, limit }
  return { ok: true }
}

/**
 * 只有验证过邮箱的账号能自助签发。
 *
 * better-auth 配了 `requireEmailVerification: true`（`lib/auth.ts`），但**session 在
 * 验证之前就已经存在** —— 那个配置管的是登录，不是"验证之前不许拿 session 做别的
 * 事"。所以这道门要显式写。
 *
 * 它挡的是批量小号：一个攻击者可以注册一千个账号，但验证一千个邮箱的成本远高于
 * 签发本身。
 */
export function assertEmailVerified(emailVerified: unknown): void {
  if (emailVerified !== true) {
    throw new ApiKeyOwnershipError(
      "请先验证邮箱再签发 API Key。一个未验证的邮箱不足以支撑一个可以调用公开 API 的账号。"
    )
  }
}

/**
 * 自助签发时忽略客户端传来的配额。
 *
 * **不是** clamp，是忽略：`createMine` 的输入 schema 里根本没有配额字段，所以这
 * 个函数拿到的一定是 `TIER_DEFAULTS.user`。它存在的意义是把"自助的配额由服务端
 * 决定"这件事写成一个可以指着的调用，而不是一句注释 —— 下一个人加字段的时候会看到
 * `issueSelfServiceKey` 里没有他以为有的那个赋值。
 */
export function selfServiceRateLimits(): {
  rateLimitRpm: number
  rateLimitRpd: number
} {
  return {
    rateLimitRpm: TIER_DEFAULTS.user.rpm,
    rateLimitRpd: TIER_DEFAULTS.user.rpd,
  }
}

/** 读一把 key 的 scopes，归一化之后的。给 `before` 用。 */
export async function readApiKeyScopes(
  db: ApiKeyReader,
  keyId: string
): Promise<ApiScope[] | null> {
  const [row] = await db
    .select({ scopes: apiKeys.scopes })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1)
  return row ? normalizeScopes(row.scopes) : null
}
