/**
 * 订阅的增删改查与签名密钥派生（设计文档 §6.2 / §6.4 / §6.7）。
 *
 * **归属是判别联合，不是两个可空参数。** `{ apiKeyId } | { userId }` 在类型层面就
 * 排除了「两个都空」和「两个都给」。数据库层的等价约束现在是 `api_key_id NOT NULL`
 * （它同时是签名 key），于是**会话建的订阅两列都非空**，原来那条
 * `subscriptions_one_owner_ck` 异或约束不再成立、已经删掉；区分两种归属改由
 * `ownerCondition` 按 `user_id is null` 分支，那里是唯一一处需要写对它的地方。
 *
 * 订阅**没有自己的签名密钥**：投递时从 `api_keys.key_hash` 现算（`deriveSigningKey`），
 * 因此没有"丢了就轮换"这回事，也没有第二个需要接收方保管的凭据。轮换与吊销是 api
 * key 层面的动作，见 `deriveSigningKey` 的注释里那两行给接收方的算法。
 */
import { createHmac, randomBytes } from "node:crypto"
import {
  and,
  desc,
  eq,
  getTableColumns,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm"
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

/**
 * 读/改/删的归属：**恰好给一个**。v1 给 key、console 会话给 userId。
 *
 * 创建另算 —— 会话路径还要一把签名 key，见 {@link SubscriptionCreator}。这里保持
 * 二选一，是为了让 `ownerCondition` 只需回答"这次是按 key 查还是按账号查"，而不是
 * 还要判断"给了两个时听谁的"。
 */
export type SubscriptionOwner = { apiKeyId: string } | { userId: string }

/**
 * 创建订阅的主体：恒有一把签名 key，会话路径再多给一个 `userId` 作归属。
 *
 * v1 的 key 来自鉴权主体（`auth.principal.keyId`），会话的 key 来自表单里的选择，
 * 两条路径落库的形状因此完全一致 —— 差别只在 `user_id` 是否为 NULL。
 */
export type SubscriptionCreator = { apiKeyId: string; userId?: string }

export type SubscriptionCreateInput = z.output<typeof subscriptionRequestSchema>
export type SubscriptionUpdateInput = z.output<typeof subscriptionUpdateSchema>

export type SubscriptionView = z.output<typeof subscriptionSchema>
export type SubscriptionCreated = z.output<typeof subscriptionCreatedSchema>
export type SubscriptionDetail = z.output<typeof subscriptionDetailSchema>

/** 投递记录条数，与 §6.8 的「最近 20 条」同数。 */
export const DELIVERY_HISTORY_LIMIT = 20

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
  includePlatform: boolean
  includeUncurated: boolean
  includeOwnSubmissions: boolean
  repoIds: string[] | null
}

function toStoredFilters(filters: RepoFilters): StoredFilters {
  return {
    projectTypes: filters.projectTypes ?? [],
    categoryCodes: filters.categoryCodes ?? [],
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
    includePlatformProjects: row.includePlatform,
    includeUncurated: row.includeUncurated,
    includeOwnSubmissions: row.includeOwnSubmissions,
    ...(row.repoIds ? { repoIds: [...row.repoIds] } : {}),
  }
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

/**
 * 订阅行 + 签名 key 的两个字段（列表与详情都要显示"用哪把 key 签名"）。
 *
 * join 而不是冗余两列进 `subscriptions`：key 改名时订阅行不必跟着改，而多一次
 * 主键 join 在这个量级上不构成开销。`signingKeyHash` 是派生验签密钥的输入，
 * 详情用它，列表只用前缀。
 */
export type SubscriptionWithKey = SubscriptionRow & {
  signingKeyPrefix: string
  signingKeyHash: string
}

export function toSubscriptionView(row: SubscriptionWithKey): SubscriptionView {
  return {
    id: row.id,
    name: row.name,
    callbackUrl: row.callbackUrl,
    signingKeyPrefix: row.signingKeyPrefix,
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

/**
 * 只有归属匹配的行才对调用方可见。这是租户隔离的全部实现（§6.7）。
 *
 * 按 key 查的那半边多带一个 `user_id is null`：会话建的订阅现在也有一把
 * `api_key_id`（用来签名），不挡住它们的话，v1 的列表会连同一用户在 console 页面上
 * 建的订阅一起返回——那是一次跨入口的泄漏，而今天的行为是 v1 只见 v1 建的。
 */
function ownerCondition(owner: SubscriptionOwner) {
  return "apiKeyId" in owner
    ? and(
        eq(subscriptions.apiKeyId, owner.apiKeyId),
        isNull(subscriptions.userId)
      )
    : eq(subscriptions.userId, owner.userId)
}

export async function createSubscription(
  db: Database,
  owner: SubscriptionCreator,
  input: SubscriptionCreateInput
): Promise<{ row: SubscriptionWithKey; signingKey: string }> {
  // 先读签名 key，再插订阅：会话路径的 `apiKeyId` 是客户端给的，这一步是它唯一
  // 的存在性检查（归属检查在 tRPC router 里，见那边的注释）。v1 路径的 key 来自
  // 鉴权主体，这一查恒成立。
  const key = await loadSigningKey(db, owner.apiKeyId)
  if (!key) throw new Error(`signing key not found: ${owner.apiKeyId}`)

  const stored = toStoredFilters(input.filters)

  const [row] = await db
    .insert(subscriptions)
    .values({
      id: `sub_${randomBytes(12).toString("base64url")}`,
      name: input.name,
      apiKeyId: owner.apiKeyId,
      userId: owner.userId ?? null,
      callbackUrl: input.callbackUrl,
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

  if (!row) throw new Error("subscription insert returned no row")
  return {
    row: { ...row, signingKeyPrefix: key.prefix, signingKeyHash: key.keyHash },
    signingKey: deriveSigningKey(key.keyHash),
  }
}

/**
 * 一把签名 key 的人工前缀与 `key_hash`（派生验签密钥的输入）。
 *
 * 只挑这两列而不是整行：`key_hash` 已经是这台机器上最敏感的一段字节，能不进内存就
 * 不进。列表与详情走 {@link subscriptionRows} 的 join，不经过这里。
 */
async function loadSigningKey(
  db: Database,
  apiKeyId: string
): Promise<{ prefix: string; keyHash: string } | undefined> {
  const [row] = await db
    .select({ prefix: apiKeys.prefix, keyHash: apiKeys.keyHash })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  return row
}

/**
 * 订阅行 + 签名 key 的两列，一条查询取完。
 *
 * `innerJoin` 而不是 left join：`api_key_id` 是 NOT NULL 且带外键，key 行一定在。
 * left join 只会让两个字段变成可空类型，然后在每一处使用点被断言掉——而断言掉的
 * 恰恰是"这条订阅拿什么签名"这个不能猜的问题。
 */
function subscriptionRows(db: Database, where: SQL | undefined) {
  return db
    .select({
      ...getTableColumns(subscriptions),
      signingKeyPrefix: apiKeys.prefix,
      signingKeyHash: apiKeys.keyHash,
    })
    .from(subscriptions)
    .innerJoin(apiKeys, eq(subscriptions.apiKeyId, apiKeys.id))
    .where(where)
}

export async function listSubscriptions(
  db: Database,
  owner: SubscriptionOwner
): Promise<SubscriptionView[]> {
  const rows = await subscriptionRows(db, ownerCondition(owner)).orderBy(
    subscriptions.createdAt,
    subscriptions.id
  )

  return rows.map(toSubscriptionView)
}

export async function getSubscription(
  db: Database,
  owner: SubscriptionOwner,
  id: string
): Promise<SubscriptionWithKey | undefined> {
  const rows = await subscriptionRows(
    db,
    and(eq(subscriptions.id, id), ownerCondition(owner))
  ).limit(1)

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
  // 会话建的两列都非空，所以先看 `user_id`：它决定的是"这条订阅归谁管"，而
  // `api_key_id` 只回答"拿什么签名"，两者不再互斥也就不能再靠非空与否来判断。
  if (row.userId) return { userId: row.userId }
  // `api_key_id` 是 NOT NULL，这里不需要兜底的第三种形状。
  return { apiKeyId: row.apiKeyId }
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
  const rows = await subscriptionRows(db, undefined).orderBy(
    desc(subscriptions.createdAt),
    subscriptions.id
  )

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
    // 验签密钥随详情一起给：它是 `key_hash` 的确定性派生，能重算就不必再设计一套
    // 「只此一次、丢了轮换」的仪式 —— 接收方要它是为了配自己的验签，而不是当凭据用。
    signingKey: deriveSigningKey(row.signingKeyHash),
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
): Promise<SubscriptionWithKey | undefined> {
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
    .returning({ id: subscriptions.id })

  // 回读而不是用 `returning()` 的整行：视图要签名 key 的两列，而它们在另一张表上。
  // 一次主键查询换掉"视图缺字段"与"更新结果和列表不一致"两种可能。
  return updated ? getSubscription(db, owner, updated.id) : undefined
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
 * 投递签名的验签密钥，从 `api_keys.key_hash` 派生。
 *
 * **一把 key 一个密钥**，同 key 名下的所有订阅共用它：接收方持有那把 key 就能验
 * 全部，不必在 key 之外再保管一份按订阅下发的凭据。派生的两步都是确定性的，所以
 * 两边不需要协商任何东西：
 *
 *   1. `sha256(key 明文)` 取 hex —— 就是库里存的 `api_keys.key_hash`；
 *   2. `base64url(HMAC-SHA256(key=SUBSCRIPTION_SIGNING_LABEL, message=上一步))`。
 *
 * 接收方自己算第 1 步（它有明文），console 从库里读第 1 步（它只有 hash）。明文
 * 因此全程不必出现在投递进程里，而 `key_hash` 泄露也只能伪造投给自家回调地址的
 * 签名 —— 调 API 要的是明文。
 *
 * 为什么不改成存一把可逆加密的密钥：那样每次投递都要解密一次，而解密密钥本身要放
 * 在同一个进程里，于是「数据库泄漏」从「拿不到明文」退化成「拿到明文 + 拿到解密
 * 密钥」。派生方案里明文只在签发 key 的那次响应里出现过。
 *
 * 吊销 key **不**停止投递（签名取的是 `key_hash` 的当前值，而那一列不随 `revoked_at`
 * 变）：吊销管的是"还能不能调 API"，与"这条订阅还要不要推"是两个问题。轮换 key 则
 * 会换掉 `key_hash`，验签密钥随之改变 —— 接收方跟着换即可，不需要任何轮换端点。
 */
export const SUBSCRIPTION_SIGNING_LABEL = "mcp-radar-subscription-v1"

/** 见 {@link deriveSigningKey}：输入是 `api_keys.key_hash`，不是某条订阅自己的密钥。 */
export function deriveSigningKey(keyHash: string): string {
  return createHmac("sha256", SUBSCRIPTION_SIGNING_LABEL)
    .update(keyHash, "utf8")
    .digest("base64url")
}

export { loadMatchReasons }