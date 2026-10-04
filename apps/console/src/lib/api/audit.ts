/**
 * 写 `api_request_audit`。
 *
 * **失败必须是响的。** 这个判断是整个文件里唯一真正难的部分，所以放在最前面。
 *
 * 一条缺失的审计行不会让任何请求失败，用户不会察觉，产品看起来完全正常 —— 然后
 * 某天凭据泄漏了，"这把 key 上周三改过权限"这个问题就再也答不出来了，而没有人在
 * 能补救的时候得到过提醒。相比之下，一次因为审计插入失败而失败的 API 调用是
 * 吵闹的、可观测的、便宜的：调用方立刻看到 5xx，我们立刻知道审计表满了。
 *
 * 所以 {@link writeApiAudit} **不**吞异常。它被所有治理类 mutation 调用，而那些
 * mutation 已经在写 `api_keys` —— 两者在同一个事务里（见 `lib/trpc/routers/
 * api-keys.ts`），所以审计写失败会把权限变更一起回滚。这是对的：宁可不给改
 * 权限，也不要改了但没记录。
 */
import type { Database } from "@/db/client"
import {
  apiRequestAudit,
  API_AUDIT_FORBIDDEN_FIELDS,
  type ApiAuditAction,
} from "@/db/schema/api-request-audit"

/**
 * 只要能 `insert` 就够了。
 *
 * 存在的原因和 `keys.ts` 的 `ApiKeyWriter` 一样：审计必须与它描述的那次变更在
 * **同一个事务**里，所以它拿到的往往是 `db.transaction(...)` 的回调参数，而不是
 * `Database` 本身。把类型写成 `Database` 会强迫调用方要么放弃同事务（那样审计写
 * 失败就不再能回滚权限变更，整个文件顶上的论证就失效了），要么撒一个不诚实的
 * 类型断言。
 */
type ApiAuditWriter = Pick<Database, "insert">

export type WriteApiAuditInput = {
  /**
   * 谁做的。列名是 `user_id`，与 `api_keys.user_id` 同名同义。
   *
   * `null` = 系统动作。**自助签发写的是用户本人的 id，而不是 `null`** —— 一条
   * `user_id IS NULL` 的 `key.create` 读起来是"某个不存在的接入方签了一把 key"，
   * 而自助的意义正是"这把 key 是这个人的，所以出问题找他"。
   */
  userId: string | null
  /** 被改动的 key。key 被删也不影响这行落库，所以没有外键。 */
  apiKeyId: string
  /** 前 4 字符，key 被删之后仍能认出是哪一把。 */
  keyPrefix: string
  action: ApiAuditAction
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  /** 吊销/改权限的理由。管理员治理动作要求用户填。 */
  reason?: string | null
  ip?: string | null
}

/**
 * 拒绝任何会带机密进库的 `before` / `after`。
 *
 * `keyHash` 之所以危险：它不是明文，所以"顺手把整行 select 出来记进去"这种写法
 * 不会被肉眼看出来，而一旦落库，`api_request_audit` 就成了一张可以离线爆破的哈希
 * 表 —— 它没有过期时间、没有 `revoked_at`，而 `api_keys` 至少有。
 *
 * 抛错而不是删字段：悄悄丢掉 `key_hash` 会让调用方以为审计记全了，而"记全了"
 * 正是这张表唯一的功能。
 */
function assertNoSecrets(
  field: string,
  value: Record<string, unknown> | null | undefined
): void {
  if (!value) return
  const forbidden = new Set<string>(API_AUDIT_FORBIDDEN_FIELDS)
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) {
      throw new Error(
        `api audit ${field} 不能包含 "${key}"：审计表没有过期机制，机密落进去就等于永久泄漏`
      )
    }
  }
}

/**
 * 写一行审计。**不吞异常**，见文件顶。
 *
 * 没有返回值：一个成功的审计插入不需要调用方知道任何事，而返回一个"写了没有"
 * 会诱导调用方去检查它 —— 而检查一个已经不该失败的写入没有意义。
 */
export async function writeApiAudit(
  db: ApiAuditWriter,
  input: WriteApiAuditInput
): Promise<void> {
  assertNoSecrets("before", input.before)
  assertNoSecrets("after", input.after)

  await db.insert(apiRequestAudit).values({
    userId: input.userId,
    apiKeyId: input.apiKeyId,
    keyPrefix: input.keyPrefix,
    action: input.action,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    ip: input.ip ?? null,
  })
}

/**
 * 从 tRPC context 的 `headers` 里取调用方 IP。
 *
 * 没有它就不要报一个值：写 `unknown` 或者从 `X-Forwarded-For` 里随便切一段看起来
 * 像 IP 的字符串，都会在真的需要查来源时给出一个错误答案。拿不到就是 `null`，这在
 * `user_id` 已经记下了归属人的前提下是可以接受的。
 *
 * 倒序优先：client, proxy1, proxy2, …，第一个是最原始的发起方。
 */
export function clientIpFromHeaders(
  headers: Headers | undefined
): string | null {
  if (!headers) return null

  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }

  return headers.get("x-real-ip")?.trim() || null
}
