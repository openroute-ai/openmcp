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
  assertTierMatchesOwner,
  buildApiKeyPlaintext,
  isApiScope,
  TIER_DEFAULTS,
  type ApiScope,
  type ApiTier,
} from "./scopes"
import { ApiKeyOwnershipError } from "./ownership"

type Database = typeof Db

/**
 * 只需要写能力的最小接口。
 *
 * `rotateApiKey` 在事务里调用 `issueApiKey`，而事务对象不是 `typeof db`
 * （它没有 `$client`）。与其 `as unknown as Database` 硬转，不如把参数收窄到实
 * 际用到的 `insert`——转换失败会变成编译错误，而不是运行时才暴露的错误。
 */
type ApiKeyWriter = Pick<Database, "insert">
/** 只要能 `select`。同样为了能在事务里调用，见 `ApiKeyWriter` 的注释。 */
type ApiKeyReader = Pick<Database, "select">
/** 三个都要：治理类的操作既要读（算 `before`），又要写，还要能跑在事务里。 */
type ApiKeyMutator = Pick<Database, "insert" | "select" | "update">

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

/**
 * 签发一把 key。
 *
 * `userId` / `tier` / `rateLimit*` 都是**可选输入**而不是在这里推断，因为这个
 * 函数是 admin 与自助两条路径的共同出口，而两者的归属规则不同：
 *
 * - 自助（`createMine`）传 `userId = 会话` 与 `tier = "user"`，两者都由
 *   `lib/api/self-service.ts` 定死，不来自客户端输入。
 * - admin（`create`）按输入给，`tier` 在它的 zod schema 里是必填项。
 *
 * 因此这里的默认值 `service` 只对**无主**的调用成立：它与 `api_keys.tier` 列的
 * 数据库默认值一致，也与 `0022` 那条 `tier = 'service' ⟺ user_id IS NULL` 的 CHECK
 * 一致。传了 `userId` 却不传 `tier` 会在下面被抛出来，而不是被猜成 `user`。
 *
 * 授权判断（"这个 scopes 能不能被这个 tier 自助拿到"）刻意**不在**这里，而在
 * `lib/api/ownership.ts`：把授权和签发写在一个函数里，第二个调用方就会绕过它。
 * 这个文件因此只负责"按给定的形状落库"，形状对不对是调用方的责任。
 */
export type IssueApiKeyInput = {
  name: string
  scopes: ApiScope[]
  /**
   * 归属人。`null` = 无主的接入方 key。
   *
   * 自助入口**不接受**它作为客户端输入，只能传会话值 —— 否则任何用户都能签发
   * 一把 `submitter_id = <受害者>` 的 key，用它提交的仓库全部记到别人名下。
   * 这与 `repos.create` 把 `userId` 整个从输入 schema 里拿掉是同一条经验。
   */
  userId?: string | null
  /** 由调用方按 tier 决定后传入，见 {@link IssueApiKeyInput.userId}。 */
  tier?: ApiTier
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
  tier: ApiTier
  userId: string | null
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

  // 无主 ⇒ service，有主 ⇒ user。`assertTierMatchesOwner` 会在 router 层把不合法的
  // 组合变成一个说人话的 400，但这里**再抛一次**而不是纠正：静默把一个
  // `tier: "service"` + 有主的输入改成别的，会让调用方的 bug 变成一行读起来完全
  // 正常的行 —— 它看起来就像管理员本来就想签一把 user tier 的 key，而实际被签发的
  // 是另一种。抛出来的那一行在日志里是唯一能追到"谁在哪儿传错了形状"的东西。
  const tier = input.tier ?? "service"
  const shape = assertTierMatchesOwner(tier, input.userId ?? null)
  if (!shape.ok) {
    throw new ApiKeyOwnershipError(shape.message)
  }

  const [row] = await db
    .insert(apiKeys)
    .values({
      id,
      keyHash: hashApiKey(secret),
      prefix,
      name: input.name,
      userId: input.userId ?? null,
      tier,
      createdBy: input.createdBy,
      submitterId: input.submitterId ?? null,
      scopes: input.scopes,
      rateLimitRpm: input.rateLimitRpm ?? TIER_DEFAULTS[tier].rpm,
      rateLimitRpd: input.rateLimitRpd ?? TIER_DEFAULTS[tier].rpd,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt })

  if (!row) throw new Error("api_keys insert returned no row")

  return {
    id: row.id,
    name: input.name,
    prefix,
    scopes: input.scopes,
    tier,
    userId: input.userId ?? null,
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
 * scopes / 限额 / 归属照搬旧 key，因为轮换的动机是换掉机密，不是改权限；要改权限
 * 就显式改 key。特别地 `userId` 必须照搬：一把自助 key 轮换之后如果变成无主的
 * service key，它的主人就再也吊销不了它了 —— 而那正是轮换要解决的那类事故。
 *
 * `markRotated` 决定是否写 `last_rotated_at`。自助轮换写（用户看到"两年没换"之后
 * 点的），admin 轮换不写（那是运维动作），所以它是一个参数而不是恒为 `true`。
 */
export async function rotateApiKey(
  db: Pick<Database, "transaction">,
  keyId: string,
  options: { markRotated?: boolean } = {}
): Promise<RotateApiKeyResult | null> {
  const { markRotated = false } = options

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        userId: apiKeys.userId,
        tier: apiKeys.tier,
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
      userId: existing.userId,
      tier: existing.tier,
      // 轮换者的身份与签发者无关：key 仍然是**原来那把**的续作，而 admin 代用户
      // 轮换不该把 createdBy 改成一个 admin —— 那样这把 key 的主人就从主人变成了
      // 管理员。所以这里保留原来的签发者；`createdBy` 只在需要审计"谁按的轮换"
      // 时由审计行承担。
      createdBy: existing.createdBy,
      submitterId: existing.submitterId,
      expiresAt: existing.expiresAt,
      rateLimitRpm: existing.rateLimitRpm,
      rateLimitRpd: existing.rateLimitRpd,
    })

    // 写在新 key 上而不是旧 key 上：新 key 才是"从现在起我用了 X 久没换"的主体。
    // 旧 key 那行的 `last_rotated_at` 留空是有意义的 —— 它已经被吊销了，没有
    // "上次轮换"可言。
    if (markRotated) {
      await tx
        .update(apiKeys)
        .set({ lastRotatedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(apiKeys.id, issued.id))
    }

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
  db: ApiKeyMutator,
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
  db: ApiKeyWriter & ApiKeyReader,
  plaintext: string
): Promise<
  | {
      id: string
      scopes: ApiScope[]
      /** 归属人。自助签发后有值；service key 为 null。见 §2.6。 */
      userId: string | null
      tier: ApiTier
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
      userId: apiKeys.userId,
      tier: apiKeys.tier,
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
 * 改一把 key 的 scopes。admin 的 `updateScopes`。
 *
 * **就地覆盖**，所以改完同一个请求就用新权限：`authenticateApiKey` 每次都查库，
 * 而 key 本身从不在 Redis 里缓存（Redis 只存配额计数），所以**没有任何缓存要清**。
 * 这正是想要的语义 —— 收窄权限必须立刻生效。
 *
 * 返回 `before` / `after` 而不是只返回一个布尔：审计行需要它们，而且"这把 key 不
 * 存在"和"改完了"是两种不同的返回值，不能都折叠成 `true`。
 */
export async function updateApiKeyScopes(
  db: ApiKeyMutator,
  keyId: string,
  scopes: ApiScope[]
): Promise<
  | { ok: false; reason: "not_found" }
  | { ok: true; before: ApiScope[]; after: ApiScope[]; changed: boolean }
> {
  const [existing] = await db
    .select({ scopes: apiKeys.scopes })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1)

  if (!existing) return { ok: false, reason: "not_found" }

  const before = normalizeScopes(existing.scopes)
  // 排序后再比，否则 `["a","b"]` 与 `["b","a"]` 会被当成一次变更，白写一条审计。
  const changed = !sameScopes(before, scopes)

  if (changed) {
    await db
      .update(apiKeys)
      .set({ scopes, updatedAt: sql`now()` })
      .where(eq(apiKeys.id, keyId))
  }

  return { ok: true, before, after: scopes, changed }
}

/**
 * 改一把 key 的配额。admin 的 `updateLimits`。
 *
 * 只改 `rate_limit_*`，**不动 scopes** —— 配额与权限是两件事，混进一次操作会让
 * "谁把发布权限给了这把 key" 变成一个同时改了配额的 diff。
 *
 * 已经吊销的 key 一样能改配额：改它不会让它复活（`revoked_at` 是独立的列），
 * 而一个运营动作因为对象已死而报错只会诱导人去先撤销吊销、再改、再重签，那中间
 * 又出现了一个凭据有效而配额未设的窗口。
 */
export async function updateApiKeyLimits(
  db: ApiKeyMutator,
  keyId: string,
  limits: { rateLimitRpm?: number; rateLimitRpd?: number }
): Promise<
  | { ok: false; reason: "not_found" }
  | {
      ok: true
      before: { rpm: number; rpd: number }
      after: { rpm: number; rpd: number }
      changed: boolean
    }
> {
  const [existing] = await db
    .select({
      rateLimitRpm: apiKeys.rateLimitRpm,
      rateLimitRpd: apiKeys.rateLimitRpd,
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1)

  if (!existing) return { ok: false, reason: "not_found" }

  const rpm = limits.rateLimitRpm ?? existing.rateLimitRpm
  const rpd = limits.rateLimitRpd ?? existing.rateLimitRpd
  const changed = rpm !== existing.rateLimitRpm || rpd !== existing.rateLimitRpd

  if (changed) {
    await db
      .update(apiKeys)
      .set({ rateLimitRpm: rpm, rateLimitRpd: rpd, updatedAt: sql`now()` })
      .where(eq(apiKeys.id, keyId))
  }

  return {
    ok: true,
    before: { rpm: existing.rateLimitRpm, rpd: existing.rateLimitRpd },
    after: { rpm, rpd },
    changed,
  }
}

/**
 * 放弃一把 key 的所有权，让 admin 接管。
 *
 * 刻意**不提供** `updateOwner`（直接转移归属）：转移会让原主人和新宿主在同一瞬间
 * 都能吊销这把 key，而 `revoke + create` 的中间窗口里凭据是明确的"旧的已死、新的
 * 还没生效"。surrender 是转移的一半 —— 它只交出所有权，凭据**继续可用**，直到
 * admin 决定吊销它为止。
 *
 * 写 `tier: "service"` 是因为它现在无主，按 §2.2 的规则无主即 service。配额跟着
 * tier 走（{@link TIER_DEFAULTS}），否则一把 user tier 的 30 rpm 的 key 会在变成
 * 接入方 key 之后仍然只有 30 rpm，而它的用途通常是后台批处理。
 */
export async function surrenderApiKey(
  db: ApiKeyMutator,
  keyId: string
): Promise<
  | { ok: false; reason: "not_found" | "already_surrendered" }
  | {
      ok: true
      before: { userId: string | null; tier: ApiTier }
      after: { userId: null; tier: ApiTier }
    }
> {
  const [existing] = await db
    .select({ userId: apiKeys.userId, tier: apiKeys.tier })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1)

  if (!existing) return { ok: false, reason: "not_found" }
  if (existing.userId === null) {
    return { ok: false, reason: "already_surrendered" }
  }

  await db
    .update(apiKeys)
    .set({
      userId: null,
      tier: "service",
      rateLimitRpm: TIER_DEFAULTS.service.rpm,
      rateLimitRpd: TIER_DEFAULTS.service.rpd,
      updatedAt: sql`now()`,
    })
    .where(eq(apiKeys.id, keyId))

  return {
    ok: true,
    before: { userId: existing.userId, tier: existing.tier },
    after: { userId: null, tier: "service" },
  }
}

/** 无序比较：`["a","b"]` 与 `["b","a"]` 是同一组 scope。 */
function sameScopes(a: readonly ApiScope[], b: readonly ApiScope[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((scope, index) => scope === right[index])
}

/**
 * 某个账号名下未吊销的 key 数。存量上限用它。
 *
 * 过期的不算：一把永不过期的自助 key 和一把明天过期的自助 key 都是"正在占位"的，
 * 但只有前者让用户明天还得再来一次。把过期算进去会让上限随时间自动松开。
 */
export async function countActiveKeysForUser(
  db: Database,
  userId: string
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), activeApiKeysFilter()))
  return row?.count ?? 0
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
export async function touchApiKeyUsage(
  db: Database,
  keyId: string
): Promise<void> {
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
