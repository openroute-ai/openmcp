/**
 * 自助签发的编排。§2.3–§2.9。
 *
 * 这个函数是 §2.11 那句话的实体："归属、scope、tier、限流全部由服务端决定"。它把
 * 四件事按**顺序**做成一件事，而顺序本身就是设计的一部分：
 *
 * 1. 邮箱已验证 —— 最便宜，且失败时不该消耗任何配额。
 * 2. scopes 是自助子集 —— 纯内存，失败时不消耗任何配额。
 * 3. 冷却 60 秒，**fail-closed** —— 一次 Redis 往返。
 * 4. 存量上限 + 插入 + 审计，**同一个事务**。
 *
 * 每一步失败之后，后面那一步都不会发生，但前面已经消耗掉的东西不一定能退回：
 * 第 3 步的冷却槽在第 4 步失败（配额满了）时不会被释放，所以一个已经签满 5 把的用户
 * 在 60 秒内重试会先看到"太频繁"而不是"已达上限"。这看起来是给用户的一个更差的
 * 错误信息，而它换来的性质是：这条路径上没有"先检查后占用"留下的缝。
 */
import { type Database } from "@/db/client"
import { getRedisClient } from "@/lib/redis/client"
import { writeApiAudit } from "./audit"
import { issueApiKey, type IssuedApiKey } from "./keys"
import {
  assertEmailVerified,
  assertKeyCountWithinLimit,
  assertSelfServiceScopes,
  selfServiceRateLimits,
} from "./ownership"
import type { ApiScope } from "./scopes"

export type SelfServiceIssueInput = {
  /** 会话里的用户 id。**不接受**客户端输入，见下方注释。 */
  userId: string
  name: string
  scopes: ApiScope[]
  emailVerified: unknown
  ip: string | null
}

export type SelfServiceIssueResult =
  | { ok: true; issued: IssuedApiKey }
  | {
      ok: false
      code:
        | "email_unverified"
        | "scope_not_allowed"
        | "rate_limited_infra"
        | "cooldown"
        | "quota_exceeded"
      message: string
      /** 只在 `quota_exceeded` 时有，用于告诉用户"你已经有几把"。 */
      current?: number
      limit?: number
    }

/** §2.4：同一个用户两次自助签发之间的最小间隔。 */
export const SELF_SERVICE_COOLDOWN_SECONDS = 60

/**
 * 冷却槽的 Redis key。
 *
 * 按 **user id** 而不是按 IP 或不按：按 IP 会让一个公司 NAT 后的所有人共享一个槽
 * （一次办公室断网重连就能让几十个真实用户同时被拒），按"每个 key 的指纹"则挡不住
 * 想多要几把的人 —— 自助 key 的用途按定义就是"每个项目一把"。要限制的是**一个账号
 * 每分钟一把**，所以 key 就该是账号。
 */
function cooldownKey(userId: string): string {
  return `console:api-keys:cooldown:${userId}`
}

/**
 * §2.4 的失败方向：Redis 不可用 ⇒ 拒绝。
 *
 * 与 `otp-store.ts` 的 `claimSlot` 相反，那里有 `if (!redis) return true`。这里的
 * 选择要区分两件事：
 *
 * - OTP 的 fail-open 影响的是**用户自己**能不能收码：一个开发环境的单机跑不出 OTP，
 *   体验是"配置 Redis 之前收不到验证码"，而替代方案是"配置 Redis 之前所有人都能
 *   绕过冷却"。
 * - 自助签发的 fail-open 影响的是**别人**：无冷却 + 无限额就是一个批量 API key
 *   铸造机，而每把 key 默认就有 30 rpm 的真实配额。花 60 秒的可用性换一个明确的
 *   上限是划算的。
 *
 * 所以这里不 fallback 到进程内 map。那种 fallback 会让"两个副本各签 5 把"变成 10
 * 把——它挡住的只是最笨的滥用者。
 */
async function claimCooldownSlot(
  userId: string
): Promise<{ ok: true } | { ok: false }> {
  const redis = getRedisClient()
  if (!redis) return { ok: false }
  // `setIfAbsent` 是 `SET key 1 NX PX ttl`：原子地"要么占住这个槽，要么告诉别人
  // 有人占了"。先 GET 再 SET 的写法在这个场景下会被两个并发请求同时通过。
  const claimed = await redis.setIfAbsent(
    cooldownKey(userId),
    "1",
    SELF_SERVICE_COOLDOWN_SECONDS * 1000
  )
  return claimed ? { ok: true } : { ok: false }
}

export async function issueSelfServiceKey(
  db: Database,
  input: SelfServiceIssueInput
): Promise<SelfServiceIssueResult> {
  try {
    assertEmailVerified(input.emailVerified)
  } catch (error) {
    return { ok: false, code: "email_unverified", message: messageOf(error) }
  }

  try {
    assertSelfServiceScopes(input.scopes)
  } catch (error) {
    return { ok: false, code: "scope_not_allowed", message: messageOf(error) }
  }

  if (!(await claimCooldownSlot(input.userId))) {
    return {
      ok: false,
      code: "cooldown",
      message: `每 ${SELF_SERVICE_COOLDOWN_SECONDS} 秒只能申请一把 API Key，请稍后再试`,
    }
  }

  // 存量上限与插入必须在同一个事务里，否则"先 count 再 insert"就是一个 TOCTOU：
  // 两个并发请求都能看到 4 把自己就都通过。冷却槽已经挡住了一次，但它是 60 秒的
  // 窗口而不是一次性的锁，两次请求完全可以都拿到 4 的读数。
  //
  // 事务抛出的错误**不**在这里翻译成某个 `SelfServiceIssueResult.code`。它们是真实
  // 的故障（连接断了、审计插入被约束拒绝），必须以 5xx 冒出去：把它们报成
  // `quota_exceeded` 会让一次数据库抖动显示成"你签满了"，把排障引向完全错误的方向。
  return db.transaction(async (tx) => {
    const within = await assertKeyCountWithinLimit(tx, input.userId)
    if (!within.ok) {
      return {
        ok: false as const,
        code: "quota_exceeded" as const,
        message: `每把 Key 都需要手动保管，你已经有 ${within.count} 把未失效的 Key 了。先吊销掉不再用的，或者用「放弃所有权」把它交给管理员代管。`,
        current: within.count,
        limit: within.limit,
      }
    }

    const issued = await issueApiKey(tx, {
      name: input.name,
      scopes: input.scopes,
      // 归属来自会话，而不是任何输入字段。一个能被客户端指定 `userId` 的自助
      // 入口，等于允许任何人签发一把 `submitter_id = <受害者>` 的 key，用它提交的
      // 仓库会全部记到那个用户名下。`repos.create` 早先踩过同一件事。
      userId: input.userId,
      submitterId: input.userId,
      // §2.2：有主人 ⇒ user tier。这一档必须**显式**传，因为 `issueApiKey` 不推断
      // ——它收到的形状是什么就落什么，缺省是 `service`，而 `service` + 有主人正是
      // `assertTierMatchesOwner` 拒绝的组合。省掉这一行的失败方式不是"配额给错了"，
      // 而是一次 500 的 `ApiKeyOwnershipError`，把"自助签发的 tier 由服务端定"这件
      // 事变成了一条只有翻代码才看得懂的报错。
      tier: "user",
      // 自助没有"谁签发的"——就是本人自己。写 admin 的 id 会让这把 key 在审计里
      // 看起来像一次管理员签发。
      createdBy: null,
      // 自助签发不设过期：给用户一个"到期后必须回来续"的负担只会把他们推向 admin
      // 去要一把长过期的 key，那反而更难管。真正该做的是轮换提示。
      expiresAt: null,
      ...selfServiceRateLimits(),
    })

    // 与插入同一个事务，所以审计写失败 = key 也不落库。见 `lib/api/audit.ts` 顶上
    // 为什么"审计必须成功"。
    await writeApiAudit(tx, {
      userId: input.userId,
      apiKeyId: issued.id,
      keyPrefix: issued.prefix,
      action: "key.create",
      before: null,
      after: {
        name: issued.name,
        scopes: issued.scopes,
        tier: issued.tier,
        // 显式写 `TIER_DEFAULTS` 而不是签发结果本身：审计要回答的是"按规则它应该
        // 是多少配额"，所以规则变了之后这张行读起来仍然是"当时按 user 档给了 30"，
        // 而从一把已存在的 key 反查配额只会得到今天改过的值。
        rateLimit: selfServiceRateLimits(),
      },
      reason: "self-service",
      ip: input.ip,
    })

    return { ok: true as const, issued }
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
