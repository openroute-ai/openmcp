/**
 * 接入方配对（设计文档 §2.11）。
 *
 * 这一层是 `/api/v1` 里唯一一个**没有凭据**的入口：它要发的东西就是凭据。安全边界
 * 等于 OAuth device flow，所以下面每一条约束都是在把那个边界补齐：
 *
 * | 约束 | 落在哪 |
 * |---|---|
 * | 码 8 字符、无歧义字符、单次有效、TTL 5 分钟 | `db/schema/connection-pairings.ts` |
 * | `returnUrl` **精确**相等 | {@link redeemPairing} |
 * | 单 IP 每小时 20 次、fail-closed | {@link claimRedeemSlot} |
 * | 明文只在兑换响应里出现一次、不写日志 | 兑换时才签发，见下 |
 *
 * ## 为什么 key 在兑换时才签发
 *
 * 设计文档原本设想"建码时签好一把 key 等着兑换"，那要求明文在数据库里躺最多 5 分钟，
 * 而这把 key 在那 5 分钟里已经是一个**可用的凭据**（谁拿到数据库快照就能调 API）。
 * 在兑换的那一刻签发，明文只出现在一个地方 —— 兑换响应 —— 这也是本文件存在的
 * 核心取舍。
 *
 * ## 兑换为什么 fail-closed
 *
 * 限流存储不可用 ⇒ 拒绝，与 `self-service.ts` 的冷却同一方向。理由也不同：那里保护的是
 * "一个账号一分钟一把"，这里保护的是"一个 40 bit 的码不能被按小时穷举"。40 bit 在 20
 * 次/小时的限制下不可能被试出来，而限制一旦 fail-open 就等于没有。
 */
import { randomBytes, randomInt } from "node:crypto"
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "@/db/client"
import {
  connectionPairings,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_SECONDS,
  PAIRING_RATE_LIMIT_PER_HOUR,
  type ConnectionPairingRow,
} from "@/db/schema/connection-pairings"
import { writeApiAudit } from "./audit"
import { issueApiKey } from "./keys"
import { getRedisClient } from "@/lib/redis/client"
import { FIXED_WINDOW_RATE_LIMIT } from "@/lib/redis/lua"
import {
  assertEmailVerified,
  assertKeyCountWithinLimit,
  assertSelfServiceScopes,
  selfServiceRateLimits,
} from "./ownership"
import type { ApiScope, ApiTier } from "./scopes"

export {
  PAIRING_CODE_TTL_SECONDS,
  PAIRING_RATE_LIMIT_PER_HOUR,
} from "@/db/schema/connection-pairings"

/**
 * 同时存在的待兑换码上限。
 *
 * 它不是安全边界（那个是 `assertKeyCountWithinLimit` + 兑换时再查一次），而是可用的
 * 边界：一个人手上挂着 20 个码时，"该把哪个发给接入方"这个问题没有答案，而每个码
 * 都是一次可能发错的机会。
 */
export const MAX_OPEN_PAIRING_CODES = 3

/**
 * 兑换时存量超限。
 *
 * 自定义异常而不是复用 `ApiKeyOwnershipError`：前者在事务**内部**抛出以触发回滚，
 * 翻译发生在事务外，两者必须能被区分开——`assertKeyCountWithinLimit` 自己抛的那些
 * 错误仍然是真故障。
 */
class PairingQuotaError extends Error {
  constructor(
    readonly count: number,
    readonly limit: number
  ) {
    super(`key quota exceeded: ${count}/${limit}`)
    this.name = "PairingQuotaError"
  }
}

/** §2.2 的自助子集。配对码只能在这三个里选，与自助签发同一份约束。 */
export const PAIRING_SCOPES: readonly ApiScope[] = [
  "repos:read",
  "repos:write",
  "rankings:read",
]

function randomCode(): string {
  let code = ""
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)]
  }
  return code
}

export type CreatePairingInput = {
  userId: string
  name: string
  scopes: ApiScope[]
  /** 兑换方必须原样回传的地址。 */
  returnUrl: string
  ip?: string | null
  /**
   * 邮箱是否已验证。与 `issueSelfServiceKey` 同一个门槛，理由见 `ownership.ts`
   * 的 `assertEmailVerified`：session 在验证之前就存在，而签发是验证之后才该有的能力。
   */
  emailVerified?: unknown
}

export type CreatePairingFailure =
  | "email_unverified"
  | "scope_not_allowed"
  | "invalid_return_url"
  | "quota_exceeded"
  | "too_many_open_codes"
  /** 连续 5 次撞码（唯一索引冲突）。内部故障，不是用户的输入问题。 */
  | "generation_failed"

export type CreatePairingResult =
  | { ok: true; code: string; expiresAt: Date; scopes: ApiScope[] }
  | { ok: false; code: CreatePairingFailure; message: string }

/**
 * 建一个配对码。
 *
 * **不写 key 行**，只写"这次兑换要发一把什么样的 key"。所以 `user_id` 有值而
 * `api_key_id` 为 `NULL` 是正常状态，不是半成品。
 */
export async function createPairing(
  input: CreatePairingInput
): Promise<CreatePairingResult> {
  try {
    assertEmailVerified(input.emailVerified)
  } catch (error) {
    return {
      ok: false,
      code: "email_unverified",
      message: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    assertSelfServiceScopes(input.scopes)
  } catch (error) {
    return {
      ok: false,
      code: "scope_not_allowed",
      message: error instanceof Error ? error.message : String(error),
    }
  }

  if (!isPlausibleReturnUrl(input.returnUrl)) {
    return {
      ok: false,
      code: "invalid_return_url",
      message: "returnUrl 必须是 http(s) 的绝对地址",
    }
  }

  // 配对是发 key 的**第二条路**，所以 §2.10 里与"能发出去多少"有关的两道门在这里
  // 一道都不能少。少了邮箱验证，一个未验证的小号就能拿到一把能调公开 API 的 key；
  // 少了存量上限，用户可以绕过 5 把的上限无限签发（兑换时才签发，但兑换也走这个
  // 上限，见 `redeemPairing`）。这两道在兑换时会再查一次——这里是"早点失败"，
  // 那里才是权威。
  //
  // 刻意**不**搬过来的第三道：60 秒 cooldown。它在自助签发里防的是"一把 key 换
  // 一次 GitHub token"的成本，而配对建码不消耗任何外部配额；这里的实际天花板是
  // `MAX_OPEN_PAIRING_CODES` × key 存量上限，两者都是每账号计数、都不需要等时间。
  // 真要限速，限流该落在兑换那侧（它已经按 IP 限了），而不是让用户为了建码空等一分钟。
  const within = await assertKeyCountWithinLimit(db, input.userId)
  if (!within.ok) {
    return {
      ok: false,
      code: "quota_exceeded",
      message: `你已经有 ${within.count} 把未失效的 Key 了（上限 ${within.limit}）。先吊销不再用的，或者用「放弃所有权」把它交给管理员代管。`,
    }
  }

  const openCodes = await countOpenPairings(input.userId)
  if (openCodes >= MAX_OPEN_PAIRING_CODES) {
    return {
      ok: false,
      code: "too_many_open_codes",
      message: `同时最多 ${MAX_OPEN_PAIRING_CODES} 个待兑换的配对码。用掉或作废一个再建新的。`,
    }
  }

  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_SECONDS * 1000)

  // 撞码就重试而不是直接失败：32^8 的空间里一次碰撞的概率极低，但"极低"不等于零，
  // 而唯一索引会在那一刻把整个请求变成一个对用户毫无意义的 500。
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode()
    const inserted = await db
      .insert(connectionPairings)
      .values({
        id: randomBytes(16).toString("base64url"),
        code,
        userId: input.userId,
        returnUrl: input.returnUrl,
        scopes: input.scopes,
        name: input.name,
        createdIp: input.ip ?? null,
        expiresAt,
      })
      .onConflictDoNothing({ target: connectionPairings.code })
      .returning({ code: connectionPairings.code })

    if (inserted.length > 0) {
      return { ok: true, code, expiresAt, scopes: input.scopes }
    }
  }

  // 五次都撞码：空间是 32^8，这个分支存在的意义是**不把一个内部故障报成一个
  // 「去作废一个码」**——后者会让用户去删一个根本没问题的配对码然后再失败一次。
  // 所以它有自己的 code：`generation_failed` 可重试且与配额无关。
  return {
    ok: false,
    code: "generation_failed",
    message: "配对码生成失败，请重试",
  }
}

/** 这个账号手上有几个还没被兑换、也还没过期的码。 */
async function countOpenPairings(userId: string): Promise<number> {
  const rows = await db
    .select({ id: connectionPairings.id })
    .from(connectionPairings)
    .where(
      and(
        eq(connectionPairings.userId, userId),
        isNull(connectionPairings.redeemedAt),
        gt(connectionPairings.expiresAt, new Date())
      )
    )
  return rows.length
}

/**
 * `returnUrl` 只做形状校验，不做前缀匹配。
 *
 * 前缀匹配会让 `https://evil.com/?x=https://mcp.openmcp.host` 通过 —— 这是最典型的
 * 开放重定向，而配对码正是把 API key 交出去的那条路。真正的相等校验在兑换时做。
 */
function isPlausibleReturnUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

/** 我建了哪些码，最新的在最前。只列没过期且没兑换的。 */
export async function listPairings(
  userId: string
): Promise<ConnectionPairingRow[]> {
  return db
    .select()
    .from(connectionPairings)
    .where(
      and(
        eq(connectionPairings.userId, userId),
        isNull(connectionPairings.redeemedAt),
        gt(connectionPairings.expiresAt, new Date())
      )
    )
    .orderBy(sql`${connectionPairings.createdAt} DESC`)
}

/** 主动作废一个码。已兑换的返回 false：它已经产生过一把 key，撤销无意义。 */
export async function revokePairing(
  userId: string,
  code: string
): Promise<boolean> {
  const rows = await db
    .delete(connectionPairings)
    .where(
      and(
        eq(connectionPairings.userId, userId),
        eq(connectionPairings.code, code),
        isNull(connectionPairings.redeemedAt)
      )
    )
    .returning({ id: connectionPairings.id })
  return rows.length > 0
}

/**
 * 兑换方的 IP 限流槽。fail-closed，理由见文件头。
 *
 * 用 Lua 而不是 `INCR` + `EXPIRE` 两次往返：两次往返之间进程崩掉会留下一个**没有
 * TTL** 的计数器，而它读起来就是"这个 IP 的额度永久用完了"（`lib/redis/lua.ts` 的
 * 文件头论证的就是这件事）。
 *
 * 刻意**不**复用 `getApiRateLimiter()`：它在 Redis 出错时 fail-open，而这里的 20 次
 * 是"这把 40 bit 的码会不会被试出来"的唯一屏障。
 */
async function claimRedeemSlot(ip: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    const raw = (await redis.eval(
      FIXED_WINDOW_RATE_LIMIT,
      [`openmcp:console:pairings:redeem:${ip}`],
      [PAIRING_RATE_LIMIT_PER_HOUR * 60 * 60, PAIRING_RATE_LIMIT_PER_HOUR]
    )) as [number, number, number]
    return Number(raw[0]) === 1
  } catch (error) {
    console.warn("[console] pairing redeem limiter unavailable:", error)
    return false
  }
}

export type RedeemResult =
  | {
      ok: true
      secret: string
      keyId: string
      name: string
      scopes: ApiScope[]
      tier: ApiTier
    }
  | { ok: false; code: RedeemErrorCode; message: string }

/**
 * 兑换失败一律 404，只有两种例外。
 *
 * 与 `guard.ts` 同一个理由，而且这里更严格：把"码不存在"、"已用过"、"已过期"、
 * "`returnUrl` 不匹配"分成不同的状态码或 code，等于给探测者一个可以拿来二分枚举的
 * oracle —— 前两个的区别告诉他码是不是真的存在过。四个原因合成一个答案，攻击者只能
 * 拿到"什么都没有"。
 *
 * 两个例外都是**不泄漏关于那个码的任何信息**的判定：
 *
 * - `rate_limited`：纯本地计数，跟码无关。
 * - `quota_exceeded`：只在码**已经通过**上面四道检查之后才可能出现，所以它不可能被
 *   用来探测一个猜出来的码；而不返回它，合法用户只会看到"配对码无效或已过期"，然后
 *   一次次重建一个永远不会被兑换的码。
 */
export type RedeemErrorCode =
  | "not_found"
  | "rate_limited"
  | "quota_exceeded"

export async function redeemPairing(input: {
  code: string
  returnUrl: string
  ip: string | null
}): Promise<RedeemResult> {
  // 拿不到 IP 就当限流已触发，而不是"跳过限流"。这里的 20 次/小时是这把 40 bit 的码
  // 唯一的屏障，`if (ip !== null)` 那种写法等于给每个能抹掉 `X-Forwarded-For` 的客户端
  // 发一张免限流卡——而匿名端点的客户端正是最没有理由守规矩的那一类。
  if (input.ip === null || !(await claimRedeemSlot(input.ip))) {
    return {
      ok: false,
      code: "rate_limited",
      message: "兑换过于频繁，请稍后再试",
    }
  }

  const normalized = input.code.trim().toUpperCase()
  const pairing = await db
    .select()
    .from(connectionPairings)
    .where(eq(connectionPairings.code, normalized))
    .limit(1)

  const row = pairing[0]
  const usable =
    row !== undefined &&
    row.redeemedAt === null &&
    row.expiresAt.getTime() > Date.now() &&
    // 精确相等。上面那行注释解释为什么不能改成前缀。
    row.returnUrl === input.returnUrl

  if (!usable || row === undefined) {
    return { ok: false, code: "not_found", message: "配对码无效或已过期" }
  }

  // 签发 + 标记已用 + 审计，同一个事务。少了任何一步：
  // - 只有签发 ⇒ 并发兑换会签出两把 key，码还能再用一次；
  // - 只有标记 ⇒ 事务回滚了码还在原地，但没有任何 key；
  // - 没有审计 ⇒ "这把 key 是配来的"这件事无人可查，而它正是泄漏排查的第一问。
  const issued = await db.transaction(async (tx) => {
    // 先抢占：`update ... where redeemed_at is null` 受行锁保护，两个并发兑换里
    // 只有一个能把这一行更新掉，另一个拿到 0 行。
    const claimed = await tx
      .update(connectionPairings)
      .set({ redeemedAt: new Date(), redeemedIp: input.ip })
      .where(
        and(
          eq(connectionPairings.id, row.id),
          isNull(connectionPairings.redeemedAt),
          gt(connectionPairings.expiresAt, new Date())
        )
      )
      .returning({ id: connectionPairings.id })

    if (claimed.length === 0) return null

    // 存量上限在这里再查一次，而这里是**权威**的那一次：key 是在这个事务里插进去的，
    // 所以 `assertKeyCountWithinLimit` 的用户行锁把并发兑换串起来了。建码时那次检查
    // 只是"早点失败"——从建码到兑换之间用户可能自己又签了两把。
    //
    // 这里**抛**而不是 `return null`：抛出去让事务回滚，连同上面那句
    // `redeemed_at` 的抢占一起撤销，所以用户在 5 分钟内吊销一把 key 之后还能用这个码
    // 重试。若只是 `return null`，事务会提交那次抢占——码被吃掉了，而用户既没拿到
    // key，也再也无法重试。
    const within = await assertKeyCountWithinLimit(tx, row.userId)
    if (!within.ok) throw new PairingQuotaError(within.count, within.limit)

    const key = await issueApiKey(tx, {
      name: row.name,
      scopes: row.scopes,
      userId: row.userId,
      // 配对拿到的 key 就是有主人的账号 key，所以 tier 是 user、归属人是建码的人。
      tier: "user",
      createdBy: row.userId,
      submitterId: row.userId,
      expiresAt: null,
      ...selfServiceRateLimits(),
    })

    await tx
      .update(connectionPairings)
      .set({ apiKeyId: key.id })
      .where(eq(connectionPairings.id, row.id))

    await writeApiAudit(tx, {
      userId: row.userId,
      apiKeyId: key.id,
      keyPrefix: key.prefix,
      action: "connection.redeem",
      after: {
        scopes: key.scopes,
        tier: key.tier,
        rateLimit: selfServiceRateLimits(),
      },
      // 兑换请求的 IP，而不是建码那个人的：审计要回答"这把 key 从哪个地址被取走"。
      reason: `pairing ${normalized}`,
      ip: input.ip,
    })

    return key
  }).catch((error: unknown) => {
    // 只翻译配额这一种。其它异常继续往上冒——它们是真实故障，报成 404 会让一次
    // 数据库抖动看起来像"码不存在"。
    if (error instanceof PairingQuotaError) {
      return {
        ok: false as const,
        code: "quota_exceeded" as const,
        message:
          `这把配对码是有效的，但签发它的账号已经有 ${error.count} 把未失效的 Key ` +
          `（上限 ${error.limit}）。请那个账号先吊销一把，或用「放弃所有权」把它交给` +
          `管理员代管，然后在 5 分钟内重试。`,
      }
    }
    throw error
  })

  // 配额超限：`.catch` 把 `PairingQuotaError` 翻译成了一个失败结果，事务已回滚，
  // 所以这个码**还能用**（见 `PairingQuotaError`）。这里靠 `"ok" in` 分流而不是靠
  // `null`：`issued` 有三个可能的形状——key、并发失败的 `null`、以及配额失败。
  if (issued !== null && "ok" in issued) return issued

  // 剩下唯一的 `null` 是并发兑换的输家：它抢不到那次 `redeemed_at is null` 更新，
  // 而那一行已经被赢家标成已兑换，所以对它来说这个答案和"码不存在"没有区别。
  if (issued === null) {
    return { ok: false, code: "not_found", message: "配对码无效或已过期" }
  }

  return {
    ok: true,
    secret: issued.secret,
    keyId: issued.id,
    name: issued.name,
    scopes: issued.scopes,
    tier: issued.tier,
  }
}

/**
 * 过期清理。只删已过期的，**不删已兑换的**：已兑换的行是"这把 key 是配来的"这件事
 * 唯一的库内证据（`api_key_id` 指回那把 key），而兑换响应之外的任何地方都查不到它。
 * 那把 key 被吊销时由外键级联处理，不需要靠删这行来"回收"。
 */
export async function purgeExpiredPairings(now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(connectionPairings)
    .where(lt(connectionPairings.expiresAt, now))
    .returning({ id: connectionPairings.id })
  return rows.length
}

/** 排障用：这个码处于哪一态。**不参与**兑换判定，只为了页面能说清"为什么用不了"。 */
export async function pairingState(
  code: string
): Promise<"unknown" | "active" | "used" | "expired"> {
  const [row] = await db
    .select({
      redeemedAt: connectionPairings.redeemedAt,
      expiresAt: connectionPairings.expiresAt,
    })
    .from(connectionPairings)
    .where(eq(connectionPairings.code, code.trim().toUpperCase()))
    .limit(1)

  if (!row) return "unknown"
  if (row.redeemedAt) return "used"
  if (row.expiresAt.getTime() <= Date.now()) return "expired"
  return "active"
}

/** 只看未过期未兑换的，运维统计用。 */
export function activePairingFilter() {
  return and(
    isNull(connectionPairings.redeemedAt),
    or(gt(connectionPairings.expiresAt, new Date()))
  )
}