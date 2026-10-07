/**
 * 订阅 payload 的组装与分段（设计文档 §6.5）。
 *
 * 与读取端点分开是有理由的：读取端点一次只服务一个调用方、只关心一个仓库，而 payload
 * 要把「命中集合 × 三个周期 × 两张榜单」压进一份 2 MB 上限的文档，还要能被切成多段
 * 按段投递。两者的形状要求相反，合在一起会得到一个谁都不合适的中间形状。
 *
 * 三条硬约束，都来自 §6.5：
 *
 * 1. **payload 必须落库**。重试要发同一份字节，否则同一个 `eventId` 会带出不同的签名，
 *    接收方的重放窗口（300s）会拒掉第二次。
 * 2. **按 `repoId` 字典序切分**，且 `eventId` 必须带上分段序号，否则同一水位线的第
 *    2 段会撞上 `webhook_deliveries_event_idx` 的唯一键。
 * 3. **只有最后一段成功才推进水位线**（见 `subscription-delivery.ts`）。
 */
import { inArray } from "drizzle-orm"
import { repos } from "@/db/schema"
import type { SubscriptionRow } from "@/db/schema/subscriptions"
import {
  fromStatsCadence,
  statsPeriodPayload,
  toStatsCadence,
  type StatsCadenceParam,
} from "@/lib/api/stats"
import {
  loadClassifications,
  platformStatusOf,
  type MatchReasonMap,
  type RepoClassification,
  type RepoFilterRow,
} from "@/lib/api/repo-filter"
import {
  buildRankingsForMonth,
  buildRankingsForWeek,
  type Rankings,
} from "@/lib/github/service/rankings"
import {
  latestStatsPerRepo,
  listStatsSince,
  type StatsCounterRow,
} from "@/lib/github/service/stats"
import {
  lastCompletePeriod,
  type StatsCadence,
} from "@/lib/github/snapshot-dates"
import type { Db } from "@/lib/github/service/repo"
import { APP_TIMEZONE } from "@/lib/time"

/** 单个 delivery 的仓库数上限（§6.5）。 */
export const MAX_REPOS_PER_PAYLOAD = 1000

/** 单个 payload 的字节上限（§6.5）。 */
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024

/**
 * 事件名。
 *
 * 与 cadence 无关，因为 §6.3 要求推送严格挂在**两个**排行任务之后：这时不存在"这是周
 * 事件还是月事件"的问题，一个名字比两个名字少一套消费方的分支。
 */
export const SUBSCRIPTION_EVENT = "data.updated"

/** 探测事件（§6.8）。与正常事件分开的名字，消费方才能把它与数据事件区别对待。 */
export const SUBSCRIPTION_TEST_EVENT = "subscription.test"

type Scope = SubscriptionRow["scopes"][number]

export interface DeliveryPayload {
  eventId: string
  event: string
  deliveredAt: string
  /** batch 模式推本期水位线；snapshot 模式为 null（§6.4）。 */
  watermark: string | null
  timezone: string
  cadence: SubscriptionRow["cadence"]
  filtersVersion: number
  counts: { repos: number; periods: number }
  repos: PayloadRepo[]
}

/** 一个仓库在 payload 里的三档统计，键与契约的 `daily` / `weekly` / `monthly` 同名。 */
export interface PayloadStats {
  daily?: unknown[] | null
  weekly?: unknown[] | null
  monthly?: unknown[] | null
}

export interface PayloadRepo extends PayloadStats {
  repoId: string
  fullName: string
  /** 为什么命中（§6.6 的规则 2-6，外加白名单的 `repoId`）。 */
  matchedBy: string[]
  classification: RepoClassification
  /** 仅当 scopes 含 `repos.metadata`。 */
  metadata?: Record<string, unknown>
  /** 仅当 scopes 含 `repos.rankings`。整份榜单对所有仓库相同，所以挂在每一条上。 */
  rankings?: { weekly: Rankings | null; monthly: Rankings | null }
}

/** 三个周期标签的存储顺序，用来遍历「另外两档」。 */
const ALL_CADENCES: StatsCadence[] = ["day", "week", "month"]

export interface BuildPayloadInput {
  subscription: SubscriptionRow
  /** 已过滤好的命中集合（`listFilteredRepos` 的输出，已按 id 升序）。 */
  rows: RepoFilterRow[]
  matchReasons: MatchReasonMap
  /** batch 的起点。snapshot 传 null。 */
  watermark: Date | null
  /** 本批要推进到的那一期；snapshot 为 null。 */
  nextWatermark: Date | null
  now: Date
}

/**
 * 组装一份 payload。
 *
 * 三档统计的分工照 §6.5：订阅自己那一档给**序列**（batch 是水位线之后的全部周期、
 * snapshot 是最新一期），另外两档只给「最近一期」作为上下文。它们不跟着水位线走——
 * 一个日订阅不该因为水位线推到了今天就把周数据也重发一遍。
 */
export async function buildPayload(
  db: Db,
  input: BuildPayloadInput
): Promise<DeliveryPayload> {
  const { subscription, rows, watermark, nextWatermark, now } = input
  const repoIds = rows.map((row) => row.id)
  const scopes = new Set<Scope>(subscription.scopes)
  const primary = toStatsCadence(subscription.cadence)
  const primaryKey = fromStatsCadence(primary)

  const [classifications, fullNames, metadataRows] = await Promise.all([
    loadClassifications(db, repoIds),
    loadFullNames(db, repoIds),
    scopes.has("repos.metadata")
      ? loadMetadata(db, repoIds)
      : Promise.resolve(new Map<string, Record<string, unknown>>()),
  ])

  // 订阅 cadence 那一档是序列，另外两档只取最新一期作为上下文。
  const primaryRows =
    subscription.mode === "batch"
      ? await listStatsSince(db, primary, watermark, repoIds)
      : await latestStatsPerRepo(db, primary, repoIds)
  const primaryByRepo = groupByRepo(primaryRows)

  const contextByCadence = new Map<StatsCadence, Map<string, unknown[] | null>>()
  for (const cadence of ALL_CADENCES) {
    if (cadence === primary) continue
    const latest = await latestStatsPerRepo(db, cadence, repoIds)
    contextByCadence.set(
      cadence,
      serialize(latest, fromStatsCadence(cadence))
    )
  }

  const rankings = scopes.has("repos.rankings")
    ? {
        weekly: await loadRankings(db, "week", now),
        monthly: await loadRankings(db, "month", now),
      }
    : undefined

  const wantsStats = scopes.has("repos.stats")
  const payloadRepos: PayloadRepo[] = rows.map((row) => {
    const entry: PayloadRepo = {
      repoId: row.id,
      fullName: fullNames.get(row.id) ?? row.id,
      matchedBy: input.matchReasons.get(row.id) ?? [],
      classification:
        classifications.get(row.id) ??
        ({
          projectTypes: [],
          categoryCode: null,
          categoryReviewed: false,
          isPlatformProject: row.isPlatformProject,
          platformStatus: platformStatusOf(row),
          tags: [],
        } satisfies RepoClassification),
    }

    const meta = metadataRows.get(row.id)
    if (meta) entry.metadata = meta

    if (wantsStats) {
      entry[primaryKey] = serialize(primaryByRepo.get(row.id) ?? [], primaryKey).get(
        row.id
      ) ?? []
      for (const cadence of ALL_CADENCES) {
        if (cadence === primary) continue
        const key = fromStatsCadence(cadence)
        entry[key] = contextByCadence.get(cadence)?.get(row.id) ?? null
      }
    }

    if (rankings) entry.rankings = rankings

    return entry
  })

  return {
    // eventId 在切分时按水位线派生（§6.5），这里先留一个占位。
    eventId: "",
    event: SUBSCRIPTION_EVENT,
    deliveredAt: now.toISOString(),
    watermark: nextWatermark ? nextWatermark.toISOString() : null,
    timezone: APP_TIMEZONE,
    cadence: subscription.cadence,
    filtersVersion: subscription.filtersVersion,
    counts: {
      repos: payloadRepos.length,
      periods: wantsStats ? primaryRows.length : 0,
    },
    repos: payloadRepos,
  }
}

/**
 * `repo_id` 收窄成 `string`。
 *
 * `StatsCounterRow` 用索引签名描述三张同构的统计表，所以 `row.repoId` 的类型是
 * `string | number | Date | null`。这里断言一次而不是给那三张表各写一个联合类型：这三
 * 张表的 `repo_id` 都是 `text NOT NULL REFERENCES repos(id)`，而真正需要小心的是
 * `period`（那张被收窄成 `Date` 的列）。
 */
function repoIdOf(row: StatsCounterRow): string {
  return row.repoId as string
}

/** 行 → 契约里那一期，按仓库归并。 */
function serialize(
  rows: StatsCounterRow[],
  cadence: StatsCadenceParam
): Map<string, unknown[]> {
  const result = new Map<string, unknown[]>()
  for (const row of rows) {
    const key = repoIdOf(row)
    const existing = result.get(key)
    const payload = statsPeriodPayload(row, cadence)
    if (existing) existing.push(payload)
    else result.set(key, [payload])
  }
  return result
}

function groupByRepo(rows: StatsCounterRow[]): Map<string, StatsCounterRow[]> {
  const result = new Map<string, StatsCounterRow[]>()
  for (const row of rows) {
    const key = repoIdOf(row)
    const existing = result.get(key)
    if (existing) existing.push(row)
    else result.set(key, [row])
  }
  return result
}

/**
 * `repoId` → `owner/name`。
 *
 * payload 里给全名而不是让消费方自己拼 `owner` + `name` 两列：GitHub 允许改名，所以
 * 两列拼出来的地址可能已经不是现在的地址，而全名是投递时那一刻的真名。
 */
async function loadFullNames(
  db: Db,
  repoIds: string[]
): Promise<Map<string, string>> {
  if (repoIds.length === 0) return new Map()
  const rows = await db
    .select({ id: repos.id, owner: repos.owner, name: repos.name })
    .from(repos)
    .where(inArray(repos.id, repoIds))

  return new Map(rows.map((row) => [row.id, `${row.owner}/${row.name}`]))
}

async function loadMetadata(
  db: Db,
  repoIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  if (repoIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: repos.id,
      owner: repos.owner,
      name: repos.name,
      description: repos.description,
      homepage: repos.homepage,
      topics: repos.topics,
      languages: repos.languages,
      licenseSpdxId: repos.licenseSpdxId,
      stars: repos.stars,
      forks: repos.forks,
      watchersCount: repos.watchersCount,
      openIssuesCount: repos.openIssuesCount,
      defaultBranch: repos.defaultBranch,
    })
    .from(repos)
    .where(inArray(repos.id, repoIds))

  return new Map(
    rows.map((row) => [
      row.id,
      {
        description: row.description ?? null,
        homepage: row.homepage ?? null,
        topics: Array.isArray(row.topics) ? row.topics : [],
        languages: Array.isArray(row.languages) ? row.languages : [],
        licenseSpdxId: row.licenseSpdxId ?? null,
        stars: typeof row.stars === "number" ? row.stars : null,
        forks: typeof row.forks === "number" ? row.forks : null,
        subscribersCount:
          typeof row.watchersCount === "number" ? row.watchersCount : null,
        openIssuesCount:
          typeof row.openIssuesCount === "number" ? row.openIssuesCount : null,
        defaultBranch: row.defaultBranch ?? null,
        repoUrl: `https://github.com/${row.owner}/${row.name}`,
      },
    ])
  )
}

/**
 * 最近一个**已闭合**周期的榜单（§6.3）。
 *
 * 用 `lastCompletePeriod` 而不是库里最大的一期：正在累积的那一周会被推出去，而 §6.3
 * 要求推送严格挂在两个排行任务之后正是为了避开这个。取不到就报 `null` 而不是抛错——
 * 榜单缺失不该让整批统计数据推不出去。
 */
async function loadRankings(
  db: Db,
  period: "week" | "month",
  now: Date
): Promise<Rankings | null> {
  try {
    const rankings =
      period === "week"
        ? await buildRankingsForWeek(db, lastCompletePeriod("week", now))
        : await buildRankingsForMonth(db, lastCompletePeriod("month", now))
    return rankings.trending.length > 0 ? rankings : null
  } catch (error) {
    console.warn("[subscriptions] rankings unavailable", {
      period,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * 水位线的 token，进 `eventId`。
 *
 * 用 epoch 毫秒而不是 ISO：ISO 串里的 `:` / `.` / `+` 让 `eventId` 不是一个能直接当
 * 文件名或 URL 片段用的东西，而消费方要拿它做幂等表的键。毫秒数在一次投递里是稳定的，
 * 且短。
 */
export function watermarkToken(watermark: Date | null): string {
  return watermark ? String(watermark.getTime()) : "snapshot"
}

/**
 * 切分成若干段，每段一个 delivery。
 *
 * 两个上限同时生效：仓库数 1000 与字节数 2 MB。字节数是硬约束，仓库数是兜底——一个仓库
 * 的 metadata + 三档统计很容易超过 2 KB，所以只留字节上限时一次投递可能只装得下两百个
 * 仓库，而分段逻辑若按 1000 算就会把三段塞进第一段。
 *
 * 切分点永远落在仓库之间，绝不切开一个仓库：接收方按 `repoId` 幂等，一个被切成两半的
 * 仓库会让「这一批收到了哪些仓库」这个问题没有答案。
 *
 * `periods` 按段统计而不是整批统计：它报的是「这一段里有多少期数据」，而消费方拿它判断
 * 自己有没有漏收，所以它必须跟着段走。
 */
export function segmentPayload(
  payload: DeliveryPayload,
  subscriptionId: string
): DeliveryPayload[] {
  const parts: { repos: PayloadRepo[]; periods: number }[] = []
  let current: PayloadRepo[] = []
  let currentBytes = 0
  let currentPeriods = 0

  for (const entry of payload.repos) {
    const bytes = Buffer.byteLength(JSON.stringify(entry), "utf8")
    const periods = countPeriods(entry)

    if (
      current.length > 0 &&
      (current.length >= MAX_REPOS_PER_PAYLOAD ||
        currentBytes + bytes > MAX_PAYLOAD_BYTES)
    ) {
      parts.push({ repos: current, periods: currentPeriods })
      current = []
      currentBytes = 0
      currentPeriods = 0
    }
    current.push(entry)
    currentBytes += bytes
    currentPeriods += periods
  }
  if (current.length > 0) parts.push({ repos: current, periods: currentPeriods })

  const token = watermarkToken(
    payload.watermark ? new Date(payload.watermark) : null
  )

  return parts.map((part, index) => ({
    ...payload,
    // 段号进 eventId：同一水位线的三段必须有三个 eventId，否则撞
    // `webhook_deliveries_event_idx` 的唯一键（§6.5）。单段时**不带**段号——最常见的
    // 那种「一批装得下」不该让消费方的幂等键凭空多一段数字。
    eventId:
      parts.length === 1
        ? `evt_${subscriptionId}_${token}`
        : `evt_${subscriptionId}_${token}_${index + 1}`,
    counts: { repos: part.repos.length, periods: part.periods },
    repos: part.repos,
  }))
}

/** 一条仓库记录里有多少期数据，三个周期都算。 */
function countPeriods(entry: PayloadRepo): number {
  const series = [entry.daily, entry.weekly, entry.monthly]
  return series.reduce((total, value) => {
    if (!Array.isArray(value)) return total
    return total + value.length
  }, 0)
}

/**
 * `POST /api/v1/subscriptions/{id}/test` 的探测 payload（§6.8）。
 *
 * 内容极小但**是真的**：一份当前命中的快照（取前 5 个仓库）。假的探测 payload 验得了
 * 签名、验不了「过滤器有没有按我想的工作」，而后者才是改过滤器时真正想知道的事。
 *
 * `watermark` 为 null 且事件名不同，所以它既不会推进水位线，也不会被当成一次数据投递。
 */
export function buildTestPayload(
  subscription: SubscriptionRow,
  now: Date,
  repos: PayloadRepo[]
): DeliveryPayload {
  return {
    eventId: `evt_test_${subscription.id}_${now.getTime()}`,
    event: SUBSCRIPTION_TEST_EVENT,
    deliveredAt: now.toISOString(),
    watermark: null,
    timezone: APP_TIMEZONE,
    cadence: subscription.cadence,
    filtersVersion: subscription.filtersVersion,
    counts: { repos: repos.length, periods: 0 },
    repos,
  }
}

/** 幂等表要的唯一键来源：payload 的字节必须与落库的那一份完全相同。 */
export function payloadBytes(payload: DeliveryPayload): string {
  return JSON.stringify(payload)
}
