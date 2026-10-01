/**
 * Issuing, hashing and rotating API keys.
 *
 * The plaintext exists in exactly one place in the process: inside `create`,
 * and it is returned to the caller and never persisted. Nothing here can read a
 * key back, which is why every read path in the app goes through `keyHash`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import type { db as Db } from "@/db/client"
import { apiKeys } from "@/db/schema/api-keys"
import {
  API_KEY_PLAINTEXT_PREFIX,
  buildApiKeyPlaintext,
  isApiScope,
  type ApiScope,
} from "./scopes"

type Database = typeof Db

/**
 * 只需要写能力的最小接口。
 *
 * `rotateApiKey` 在事务里调用 `issueApiKey`，而事务对象不是 `typeof db`
 * （它没有 `$client`）。与其 `as unknown as Database` 硬转，不如把参数收窄到实
 * 际用到的 `insert`——转换失败会变成编译错误，而不是运行时才暴露的错误。
 */
type ApiKeyWriter = Pick<Database, "insert">

/**
 * sha256 而不是 bcrypt / argon2。
 *
 * 这把 key 是 256 bit 随机串，不是人选的口令：没有字典可打，慢哈希换来的只有
 * 每次 API 调用几十到几百毫秒。这里要防的是数据库泄漏后直接拿到明文，sha256
 * 够用；同样的取舍见 `docs/design/API_KEY_LITELLM_PROXY.md`。
 */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex")
}

/**
 * `randomBytes(32)` 是 256 bit 熵。prefix 另取 `randomBytes(3)`，两者独立，
 * 这样展示用的前缀不泄漏机密部分的任何一位。
 *
 * base64url 而非 hex：同样的熵下短 1/3，而 key 要被人复制粘贴，26 位比 64 位更
 * 少出错。
 */
function generateSecret(): string {
  return randomBytes(32).toString("base64url")
}

function generatePrefix(): string {
  return randomBytes(3).toString("base64url")
}

export type IssueApiKeyInput = {
  name: string
  scopes: ApiScope[]
  createdBy: string | null
  submitterId?: string | null
  expiresAt?: Date | null
  rateLimitRpm?: number
  rateLimitRpd?: number
}

/** 明文只在这一次响应里出现；之后任何地方都取不回来。 */
export type IssuedApiKey = {
  id: string
  name: string
  prefix: string
  scopes: ApiScope[]
  createdAt: Date
  /** `mcp_radar_<prefix>_<secret>`。**不落库。 */
  secret: string
}

export async function issueApiKey(
  db: ApiKeyWriter,
  input: IssueApiKeyInput
): Promise<IssuedApiKey> {
  const plaintext = generateSecret()
  const prefix = generatePrefix()
  const secret = buildApiKeyPlaintext(prefix, plaintext)
  const id = randomBytes(16).toString("base64url")

  const [row] = await db
    .insert(apiKeys)
    .values({
      id,
      keyHash: hashApiKey(secret),
      prefix,
      name: input.name,
      createdBy: input.createdBy,
      submitterId: input.submitterId ?? null,
      scopes: input.scopes,
      rateLimitRpm: input.rateLimitRpm ?? 60,
      rateLimitRpd: input.rateLimitRpd ?? 5000,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt })

  if (!row) throw new Error("api_keys insert returned no row")

  return {
    id: row.id,
    name: input.name,
    prefix,
    scopes: input.scopes,
    createdAt: row.createdAt,
    secret,
  }
}

export type RotateApiKeyResult = {
  /** 新 key 的完整记录，含一次性明文。 */
  issued: IssuedApiKey
  /** 被顶掉的那把。 */
  revokedId: string
}

/**
 * 轮换 = 吊销旧的 + 签发一把新的，在同一个事务里。
 *
 * 刻意**不是**"先建新的、再手工删旧的"：那个中间窗口里两把凭据同时有效，泄漏
 * 事件的排查也只能靠时间戳猜哪把是本该作废的。
 *
 * scopes / 限额照搬旧 key，因为轮换的动机是换掉机密，不是改权限；要改权限就
 * 显式改 key。
 */
export async function rotateApiKey(
  db: Database,
  keyId: string
): Promise<RotateApiKeyResult | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        createdBy: apiKeys.createdBy,
        submitterId: apiKeys.submitterId,
        expiresAt: apiKeys.expiresAt,
        rateLimitRpm: apiKeys.rateLimitRpm,
        rateLimitRpd: apiKeys.rateLimitRpd,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.id, keyId))
      .limit(1)

    if (!existing) return null
    // 轮换一把已吊销的 key 会得到一把新的，同时留下一条更早的吊销记录，读起来
    // 像"恢复过"。这几乎总是调用方的 bug。
    if (existing.revokedAt) {
      throw new Error(`api key ${keyId} is already revoked`)
    }

    await tx
      .update(apiKeys)
      .set({
        revokedAt: sql`now()`,
        revokedReason: "rotated",
        updatedAt: sql`now()`,
      })
      .where(eq(apiKeys.id, keyId))

    const issued = await issueApiKey(tx, {
      name: existing.name,
      scopes: existing.scopes as ApiScope[],
      createdBy: existing.createdBy,
      submitterId: existing.submitterId,
      expiresAt: existing.expiresAt,
      rateLimitRpm: existing.rateLimitRpm,
      rateLimitRpd: existing.rateLimitRpd,
    })

    return { issued, revokedId: keyId }
  })
}

/**
 * 吊销。立即生效——鉴权每次都读库，没有需要清的缓存。
 *
 * 对已吊销的 key 再吊销一次是幂等的，不报错：`revokedReason` 不被覆盖，因为
 * 第一次吊销的��因才是持有者需要知道的那个。
 */
export async function revokeApiKey(
  db: Database,
  keyId: string,
  reason: string | null
): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({
      revokedAt: sql`now()`,
      revokedReason: reason,
      updatedAt: sql`now()`,
    })
    .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id })

  return rows.length > 0
}

/**
 * 按明文查 key。鉴权的第一步。
 *
 * 返回的行仍需检查 `revokedAt` / `expiresAt`：这里是唯一一次数据库往返，把两个
 * 状态一起带出去才能在下一层判定，省掉两次查询。
 */
export async function findApiKeyByPlaintext(
  db: Database,
  plaintext: string
): Promise<
  | {
      id: string
      scopes: ApiScope[]
      submitterId: string | null
      rateLimitRpm: number
      rateLimitRpd: number
      revokedAt: Date | null
      expiresAt: Date | null
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: apiKeys.id,
      scopes: apiKeys.scopes,
      submitterId: apiKeys.submitterId,
      rateLimitRpm: apiKeys.rateLimitRpm,
      rateLimitRpd: apiKeys.rateLimitRpd,
      revokedAt: apiKeys.revokedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashApiKey(plaintext)))
    .limit(1)

  if (!row) return undefined
  return { ...row, scopes: normalizeScopes(row.scopes) }
}

/**
 * 把数据库里的 `text[]` 收成 `ApiScope[]`。
 *
 * 列的类型是 `text[]` 而不是枚举数组，所以一个手写 SQL 或一次历史迁移都可能带
 * 进当前 `API_SCOPES` 里没有的值。把未知 scope 丢在这里而不是让它们一路流到
 * 权限判定里，意味着未知值等同于"没有这个权限"——`hasScope` 因此 fail-closed。
 *
 * 这条分支在正常路径上永远走不到，但它存在的理由正是异常路径。
 */
export function normalizeScopes(values: readonly string[]): ApiScope[] {
  return values.filter(isApiScope)
}

/**
 * 活动 key 列表：未吊销且未过期。
 *
 * 过期不是 `expires_at > now()`——`NULL` 表示不过期，所以要 `IS NULL OR >now`。
 * 漏掉这个分支会把所有永不过期的 key 从列表里隐藏掉，而它们恰恰是数量最多的
 * 一批。
 */
export function activeApiKeysFilter() {
  return and(
    isNull(apiKeys.revokedAt),
    or(isNull(apiKeys.expiresAt), sql`${apiKeys.expiresAt} > now()`)
  )
}

/**
 * 写 `last_used_at`，不阻塞响应。
 *
 * 每次请求一次 UPDATE 太重，而这一列的用途是"这把 key 还在用吗"，不是审计。
 * 因此异步写、失败只记日志：一次丢失只会让时间戳差几秒，不会让鉴权出错。
 *
 * 返回 Promise 让测试可以 await；生产调用方不 await。
 */
export async function touchApiKeyUsage(db: Database, keyId: string): Promise<void> {
  try {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(apiKeys.id, keyId))
  } catch (error) {
    console.warn("[console] could not record api key usage:", error)
  }
}

/**
 * 常量时间比较，用于比对 hash。
 *
 * 现在只在测试里用得上——鉴权路径比的是数据库的精确匹配，不是本地比较。留着是
 * 因为它属于 hashApiKey 的正确用法，而正确的用法不该被重新发明。
 */
export function apiKeyHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex")
  const right = Buffer.from(b, "hex")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export { API_KEY_PLAINTEXT_PREFIX }