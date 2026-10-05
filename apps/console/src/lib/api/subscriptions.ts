/**
 * 订阅的增删改查与密钥轮换（设计文档 §6.2 / §6.4 / §6.7）。
 *
 * **归属是判别联合，不是两个可空参数。** `{ apiKeyId } | { userId }` 在类型层面就
 * 排除了「两个都空」和「两个都给」，而 `subscriptions_one_owner_ck` 在数据库层面排除
 * 同样的两种情况。用两个可空参数的话，那条 CHECK 会变成一层"服务层本来就不该让它
 * 发生"的保护，于是某天有人加了个新入口忘了判空，租户隔离就在那一行漏掉了。
 *
 * 明文密钥只在这里的 `createSubscription` / `rotateSubscriptionSecret` 两次返回里出现。
 * `secretHash` 是 `sha256(明文)`，与 `api_keys.key_hash` 同一种取舍：随机串不是人选的
 * 口令，没有字典可抗，而慢哈希要让每一次投递付出一段延迟。
 */
import { createHash, createHmac, randomBytes } from "node:crypto"
import { and, desc, eq, sql, type SQL } from "drizzle-orm"
import { apiKeys } from "@/db/schema/api-keys"
import {
  subscriptions,
  webhookDeliveries,
  type SubscriptionRow,
} from "@/db/schema/subscriptions"
import { toStatsCadence } from "@/lib/api/stats"
import {
  listFilteredRepos,
  loadMatchReasons,
  resolveIncludeUncurated,
  type RepoFilters,
} from "@/lib/api/repo-filter"
import { earliestPeriodForRepos } from "@/lib/github/service/stats"
import type { Db } from "@/lib/github/service/repo"
import type { z } from "zod"
import type {
  subscriptionCreatedSchema,
  subscriptionDetailSchema,
  subscriptionRequestSchema,
  subscriptionRotatedSchema,
  subscriptionSchema,
  subscriptionUpdateSchema,
} from "@/lib/api/contract"
import type { SubscriptionScope } from "@/db/schema/subscriptions"
import type { ProjectType } from "@/db/schema"

/**
 * `Db = Database | Tx`（`service/repo.ts`），而不是 `typeof dbClient`。
 *
 * 收窄到事务对象，是为了让这些函数能同时被 HTTP 路由（连接）与投递任务（runner 给的
 * 事务）调用。反过来放宽到 `typeof dbClient` 会让投递任务编译不过，而它的 `db` 来自
 * `TaskContext`。
 */
type Database = Db

/**
 * `update` 的 `set` 载荷。
 *
 * 手写而不是 `Partial<$inferInsert>`：`updatedAt` 与 `filtersVersion` 在这里是 SQL
 * 表达式（`now()`、`filters_version + 1`），而 `$inferInsert` 把它们约束成
 * `Date` / `number`。drizzle 运行期接受，类型层不接受。
 */
type UpdateSet = Partial<Omit<typeof subscriptions.$inferInsert, "updatedAt" | "filtersVersion">> & {
  updatedAt: SQL
  filtersVersion?: SQL
}

export type SubscriptionOwner = { apiKeyId: string } | { userId: string }

export type SubscriptionCreateInput = z.output<typeof subscriptionRequestSchema>
export type SubscriptionUpdateInput = z.output<typeof subscriptionUpdateSchema>

export type SubscriptionView = z.output<typeof subscriptionSchema>
export type SubscriptionCreated = z.output<typeof subscriptionCreatedSchema>
export type SubscriptionDetail = z.output<typeof subscriptionDetailSchema>
export type SubscriptionRotated = z.output<typeof subscriptionRotatedSchema>

/** 投递记录条数，与 §6.8 的「最近 20 条」同数。 */
export const DELIVERY_HISTORY_LIMIT = 20

/**
 * `sha256(hex)`。与 `lib/api/keys.ts` 的 `hashApiKey` 刻意重复而不是复用：那一处
 * 带着一整段解释为什么不用 bcrypt 的注释，复制过来会让两个函数看起来像两份独立的
 * 决策，而它们其实是同一条决策。
 */
function hashSecret(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex")
}

/**
 * 服务端生成的密钥。
 *
 * `randomBytes(32)` 是 256 bit 熵；前缀另取 `randomBytes(3)`（base64url 后 4 字符），
 * 两者独立取，所以展示用的前缀不泄漏机密部分的任何一位。形状是 `<prefix>_<secret>`，
 * 前缀同时就是 `secretPrefix` —— 人读的那 4 位与签名用的那段是同一个串的前 4 位，
 * 少一次映射也就少一处能写错的对应关系。
 */
function generateSecret(): string {
  const prefix = randomBytes(3).toString("base64url")
  return `${prefix}_${randomBytes(32).toString("base64url")}`
}

/** 契约的 `secretPrefix` 只是人工比对，所以统一取明文前 4 位，用户自带密钥也一样。 */
function prefixOf(plaintext: string): string {
  return plaintext.slice(0, 4)
}

/**
 * 过滤器落库前的形状。
 *
 * 数组一律存成非空数组（空数组而不是 NULL）：NULL 会让「没给这个过滤器」与「给了
 * 空数组」在投递时的每一处判断里都要分开处理，而空数组本身就能表达后者。`repoIds`
 * 是唯一的例外 —— 它刻意可空，因为空数组（白名单是空的，一个都不推）与 NULL（没给
 * 白名单）是两个意思，见 §6.6 规则 1。
 */
interface StoredFilters {
  projectTypes: ProjectType[]
  categoryCodes: string[]
  platformTypes: ProjectType[]
  includePlatform: boolean
  includeUncurated: boolean
  includeOwnSubmissions: boolean
  repoIds: string[] | null
}

function toStoredFilters(filters: RepoFilters): StoredFilters {
  return {
    projectTypes: filters.projectTypes ?? [],
    categoryCodes: filters.categoryCodes ?? [],
    platformTypes: filters.platformTypes ?? [],
    // 三个开关的缺省见 `resolveFilters`：只有 `includeUncurated` 是推导出来的，
    // 另外两个的缺省就是 §6.1 里的列默认值 `true`。存成解析后的布尔值而不是存
    // 「调用方给了什么」，是为了让投递任务不必再跑一遍推导 —— 推导规则会演进，而
    // 已存的订阅不该因为规则变了就换一个含义。
    includePlatform: filters.includePlatformProjects !== false,
    includeUncurated: resolveIncludeUncurated(filters),
    includeOwnSubmissions: filters.includeOwnSubmissions !== false,
    repoIds:
      filters.repoIds && filters.repoIds.length > 0 ? filters.repoIds : null,
  }
}

/** 反向：把列还原成契约里 `filters` 的形状。列表与详情用它，所以默认值在这里也可见。 */
export function toFilters(row: SubscriptionRow): RepoFilters {
  return {
    // 列是 `text[]`，而契约的这两个字段是枚举数组。枚举成员由写入路径保证
    // （`subscriptionRequestSchema` 的 `z.array(z.enum(PROJECT_TYPES))`），所以这里
    // 是一次收窄而不是一次校验；要校验就得在每次读路径上多跑一遍 zod。
    projectTypes:
      row.projectTypes.length > 0
        ? ([...row.projectTypes] as ProjectType[])
        : undefined,
    categoryCodes: row.categoryCodes.length > 0 ? [...row.categoryCodes] : undefined,
    platformTypes:
      row.platformTypes.length > 0
        ? ([...row.platformTypes] as ProjectType[])
        : undefined,
    includePlatformProjects: row.includePlatform,
    includeUncurated: row.includeUncurated,
    includeOwnSubmissions: row.includeOwnSubmissions,
    ...(row.repoIds ? { repoIds: [...row.repoIds] } : {}),
  }
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

export function toSubscriptionView(row: SubscriptionRow): SubscriptionView {
  return {
    id: row.id,
    name: row.name,
    callbackUrl: row.callbackUrl,
    secretPrefix: row.secretPrefix,
    cadence: row.cadence,
    mode: row.mode,
    scopes: [...row.scopes] as SubscriptionView["scopes"],
    filters: toFilters(row),
    filtersVersion: row.filtersVersion,
    enabled: row.enabled,
    disabledReason: row.disabledReason,
    watermark: isoOrNull(row.watermark),
    createdAt: row.createdAt.toISOString(),
    expiresAt: isoOrNull(row.expiresAt),
  }
}

/** 只有归属匹配的行才对调用方可见。这是租户隔离的全部实现（§6.7）。 */
function ownerCondition(owner: SubscriptionOwner) {
  return "apiKeyId" in owner
    ? eq(subscriptions.apiKeyId, owner.apiKeyId)
    : eq(subscriptions.userId, owner.userId)
}

export async function createSubscription(
  db: Database,
  owner: SubscriptionOwner,
  input: SubscriptionCreateInput
): Promise<{ row: SubscriptionRow; secret: string }> {
  const secret = input.secret ?? generateSecret()
  const stored = toStoredFilters(input.filters)

  const [row] = await db
    .insert(subscriptions)
    .values({
      id: `sub_${randomBytes(12).toString("base64url")}`,
      name: input.name,
      ...owner,
      callbackUrl: input.callbackUrl,
      secretHash: hashSecret(secret),
      secretPrefix: prefixOf(secret),
      cadence: input.cadence,
      scopes: input.scopes as SubscriptionScope[],
      ...stored,
      mode: input.mode,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      // `watermark` 刻意留 NULL：batch 的第一批是「所有已存周期的起点」（§6.4 第 1 步），
      // 而那个起点由投递任务在第一次运行时按命中的仓库集算出来。这里预填一个「创建
      // 时刻」会让第一批从创建那天开始，恰好漏掉订阅建立之前就已经存在的数据。
      watermark: null,
    })
    .returning()

  return { row: row!, secret }
}

export async function listSubscriptions(
  db: Database,
  owner: SubscriptionOwner
): Promise<SubscriptionView[]> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(ownerCondition(owner))
    .orderBy(subscriptions.createdAt, subscriptions.id)

  return rows.map(toSubscriptionView)
}

export async function getSubscription(
  db: Database,
  owner: SubscriptionOwner,
  id: string
): Promise<SubscriptionRow | undefined> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, id), ownerCondition(owner)))
    .limit(1)

  return rows[0]
}

/**
 * 行本身的归属主体。
 *
 * 存在的理由是管理员视图：它要读**别人**的订阅，而上面两个函数都要求调用方先知道
 * 归属才能读。管理员拿到行之后把它转回判别联合，再交给同一个 `getSubscriptionDetail`，
 * 于是「详情怎么算」（matched repos、水位线回退、排障字段）只有一份实现，而归属过滤
 * 仍然在 SQL 里发生一次——不是「先读全部再在内存里过滤」。
 */
export function ownerOf(row: SubscriptionRow): SubscriptionOwner {
  if (row.userId) return { userId: row.userId }
  // CHECK 保证恰好一个非空，所以这里不需要兜底的第三种形状：造一个
  // `{ apiKeyId: undefined }` 只会把一条坏行变成一条查不到东西的查询。
  return { apiKeyId: row.apiKeyId as string }
}

/** 按 id 读一行，不带归属过滤。**只在 `adminProcedure` 里调用。 */
export async function findSubscriptionById(
  db: Database,
  id: string
): Promise<SubscriptionRow | undefined> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .limit(1)

  return rows[0]
}

/**
 * 全部订阅，两种归属都返回。**只在 `adminProcedure` 里调用。**
 *
 * 与 `listSubscriptions` 分成两个函数而不是加一个 `owner` 可选的参数：可选参数会让
 * 「忘了传 owner」变成一次静默的全站读取，而租户隔离的失败模式恰恰是这种没人发现的
 * 那种（§6.7）。要管理员视图就得写出 `listAllSubscriptions` 这几个字。
 */
export async function listAllSubscriptions(
  db: Database
): Promise<(SubscriptionView & { apiKeyId: string | null; userId: string | null })[]> {
  const rows = await db
    .select()
    .from(subscriptions)
    .orderBy(desc(subscriptions.createdAt), subscriptions.id)

  return rows.map((row) => ({
    ...toSubscriptionView(row),
    apiKeyId: row.apiKeyId,
    userId: row.userId,
  }))
}

/**
 * 订阅方的投递主体，也就是 §6.6 那个 `$owner`。
 *
 * M2M key 取 `api_keys.submitter_id` 而不是 `subscriptions.user_id`：一条 key 归属的
 * 订阅要推的是「这把 key 提交过的仓库」，与这把 key 归谁所有无关（§6.7 的表把两列并排
 * 写就是为了这一点）。console 用户自己的订阅则直接是会话用户。
 *
 * 异步是因为它要 join 一次 `api_keys`。**不能改成把 submitter 冗余进
 * `subscriptions`**：那要在每次改 key 的提交人时同步所有订阅，而漏掉一次的后果是
 * 订阅开始推另一个人的提交 —— 一个没人会发现、也没法解释的泄漏。
 */
export async function resolveOwnerUserId(
  db: Database,
  row: SubscriptionRow
): Promise<string | null> {
  if (row.userId) return row.userId
  if (!row.apiKeyId) return null

  const keys = await db
    .select({ submitterId: apiKeys.submitterId })
    .from(apiKeys)
    .where(eq(apiKeys.id, row.apiKeyId))
    .limit(1)

  return keys[0]?.submitterId ?? null
}

/**
 * 详情：契约的订阅对象 + 排障用的投递状态（§6.8）。
 *
 * `matchedRepos` 与投递历史各一次查询，且都在归属过滤之后 —— 否则调用方能通过
 * 「订阅不我的，但它的 matchedRepos 是多少」侧信道量出别人的订阅规模。
 */
export async function getSubscriptionDetail(
  db: Database,
  owner: SubscriptionOwner,
  id: string
): Promise<SubscriptionDetail | undefined> {
  const row = await getSubscription(db, owner, id)
  if (!row) return undefined

  const matched = await listFilteredRepos(
    db as Db,
    toFilters(row),
    await resolveOwnerUserId(db, row)
  )
  const deliveries = await db
    .select({
      eventId: webhookDeliveries.eventId,
      status: webhookDeliveries.status,
      attempt: webhookDeliveries.attempt,
      httpStatus: webhookDeliveries.httpStatus,
      error: webhookDeliveries.error,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.subscriptionId, row.id))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(DELIVERY_HISTORY_LIMIT)

  return {
    ...toSubscriptionView(row),
    matchedRepos: matched.length,
    lastDeliveredAt: isoOrNull(row.lastDeliveredAt),
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    deliveries: deliveries.map((delivery) => ({
      eventId: delivery.eventId,
      status: delivery.status,
      attempt: delivery.attempt,
      httpStatus: delivery.httpStatus,
      error: delivery.error,
      createdAt: delivery.createdAt.toISOString(),
    })),
  }
}

/**
 * 更新订阅。
 *
 * **过滤器变了就把水位线回退**（§6.4），而这件事必须在同一个事务里：版本号 +1 与水位线
 * 回退要么都发生要么都不发生，否则会出现「版本已经是 2、水位线却还是旧的」——消费方
 * 按版本判断这是补发，而服务端其实从没打算重推。
 *
 * 回退目标是**新命中集合的最早已存周期**，不是全库起点，也不是单个仓库的起点。
 * 空命中集合时既不推进也不回退：把水位线退到「当前没有任何仓库」的集合的起点，等于
 * 让下一次投递把整张表重推一遍（§6.4 的取舍：可能重推优于静默漏推）。
 *
 * 改 `enabled: true` 时顺带清掉熔断留下的 `disabled_reason`：那是「连续失败到熔断」的
 * 结论，恢复订阅而留着它，读起来像仍然被熔断着。
 */
export async function updateSubscription(
  db: Database,
  owner: SubscriptionOwner,
  id: string,
  patch: SubscriptionUpdateInput
): Promise<SubscriptionRow | undefined> {
  const existing = await getSubscription(db, owner, id)
  if (!existing) return undefined

  const filtersChanged = patch.filters !== undefined
  const rewind = filtersChanged
    ? await rewindTarget(db, existing, patch.filters!)
    : undefined

  const sets: UpdateSet = { updatedAt: sql`now()` }
  if (patch.name !== undefined) sets.name = patch.name
  if (patch.callbackUrl !== undefined) sets.callbackUrl = patch.callbackUrl
  if (patch.scopes !== undefined) sets.scopes = patch.scopes as SubscriptionScope[]
  if (patch.expiresAt !== undefined) {
    sets.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null
  }
  if (filtersChanged) {
    const stored = toStoredFilters(patch.filters!)
    Object.assign(sets, stored)
    sets.filtersVersion = sql`${subscriptions.filtersVersion} + 1`
    if (rewind) sets.watermark = rewind
  }

  if (patch.enabled !== undefined) {
    sets.enabled = patch.enabled
    if (patch.enabled) {
      // 恢复即清熔断痕迹。`consecutive_failures` 一并清零，否则下一轮投递只要再失败
      // 一次就又立刻熔断，而用户明明刚点过「恢复」。
      sets.disabledReason = null
      sets.consecutiveFailures = 0
    }
  }

  const [updated] = await db
    .update(subscriptions)
    .set(sets)
    .where(and(eq(subscriptions.id, id), ownerCondition(owner)))
    .returning()

  return updated
}

/**
 * 新过滤器下应当回退到的水位线。
 *
 * 返回 `undefined` 表示「不动」。三种不动的情况：过滤器没变、命中的集合里一个已存
 * 周期都没有、以及本来就没有水位线可回退。
 */
async function rewindTarget(
  db: Database,
  existing: SubscriptionRow,
  filters: RepoFilters
): Promise<Date | null | undefined> {
  const owner = await resolveOwnerUserId(db, existing)
  const matched = await listFilteredRepos(db as Db, filters, owner)
  if (matched.length === 0) return undefined

  const earliest = await earliestPeriodForRepos(
    db as Db,
    toStatsCadence(existing.cadence),
    matched.map((row) => row.id)
  )
  // 命中了仓库但一个周期都没存过：往回退也没有可退的位置，保持原样。
  if (!earliest) return undefined

  // 已经比这个起点更早就不用动。
  if (existing.watermark && existing.watermark <= earliest) return undefined
  return earliest
}

/** 删除。队列随 `webhook_deliveries.subscription_id` 的 CASCADE 一起消失。 */
export async function deleteSubscription(
  db: Database,
  owner: SubscriptionOwner,
  id: string
): Promise<boolean> {
  const deleted = await db
    .delete(subscriptions)
    .where(and(eq(subscriptions.id, id), ownerCondition(owner)))
    .returning({ id: subscriptions.id })

  return deleted.length > 0
}

/**
 * 轮换签名密钥。
 *
 * 旧密钥**立刻**失效：这里只覆盖 `secret_hash` 一列，没有「上一把密钥仍然有效」的
 * 宽限期——否则轮换就变成了一个需要解释「什么时候彻底生效」的动作，而真正的轮换
 * 需求（密钥疑似泄露）要求的是立刻。
 *
 * 与 `rotateApiKey` 不同的是这里**不**留旧记录：`api_keys` 留 `revoked_at` 是因为一把
 * key 可以有多个签发记录要能对账，而订阅密钥只用于验签，没有任何审计价值。
 */
export async function rotateSubscriptionSecret(
  db: Database,
  owner: SubscriptionOwner,
  id: string
): Promise<SubscriptionRotated | undefined> {
  const existing = await getSubscription(db, owner, id)
  if (!existing) return undefined

  const secret = generateSecret()
  const rotatedAt = new Date()

  await db
    .update(subscriptions)
    .set({
      secretHash: hashSecret(secret),
      secretPrefix: prefixOf(secret),
      updatedAt: sql`now()`,
    })
    .where(and(eq(subscriptions.id, id), ownerCondition(owner)))

  return {
    id: existing.id,
    secretPrefix: prefixOf(secret),
    secret,
    rotatedAt: rotatedAt.toISOString(),
  }
}

/**
 * 投递签名的密钥，从库里存的那份 `secret_hash` 推出来。
 *
 * **§6.1 只存 `sha256(明文)`，而 §6.5 要用密钥做 HMAC 签名 —— 这两件事不可能同时
 * 成立**，除非签名密钥由 hash 派生。设计文档自己没有写出这一步（§4.3 为 api key 的
 * callback secret 写了同一件事的另一个实例：`HMAC(key="mcp-radar-callback-v1",
 * message=sha256(keyHash))`），所以这里照 §4.3 的形状补上，并把它导出：接收方拿到
 * 明文后做同样两步就能验签，而明文全程不必出现在投递进程里。
 *
 * 为什么不改成存可逆加密的密钥：那样每次投递都要解密一次才能签名，而解密密钥本身要
 * 放在同一个进程里，于是「数据库泄漏」从「拿不到明文」退化成「拿到明文 + 拿到解密
 * 密钥」。派生方案里明文只在 create / rotate 的响应里存在过一次。
 */
export const SUBSCRIPTION_SIGNING_LABEL = "mcp-radar-subscription-v1"

/**
 * `base64url(HMAC-SHA256(key=label, message=sha256(明文)))`。
 *
 * 接收方的算法：`sha256(明文)` 取 hex，再走一次上面这个 HMAC，得到的 base64url 串就是
 * 验签用的密钥。两次变换都是确定性的，所以两边不需要协商任何东西。
 */
export function deriveSigningKey(secretHash: string): string {
  return createHmac("sha256", SUBSCRIPTION_SIGNING_LABEL)
    .update(secretHash, "utf8")
    .digest("base64url")
}

export { loadMatchReasons }