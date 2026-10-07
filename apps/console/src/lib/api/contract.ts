/**
 * HTTP 契约的唯一来源：`/api/v1/*` 的请求体与响应体。
 *
 * 两个消费者是同一批 schema：路由用 `satisfies` 在编译期检查自己拼出来的对象，
 * `lib/openapi/document.ts` 用 `z.toJSONSchema()` 把它们聚合成 OpenAPI 3.1 文档。
 * 字段写两遍就一定会漂一次，所以这里只写一遍。
 *
 * 覆盖范围以 `docs/design/CONSOLE_OPEN_RADAR_API.md` §1.1 的路由清单为准：读取、
 * 写入、订阅，以及那份需要凭据的自描述端点——**没有匿名端点**，所以每一个
 * `/api/v1` 路由的鉴权都是 Bearer key。
 */
import { z } from "zod"
import {
  ANOMALY_KINDS,
  ANOMALY_SEVERITIES,
  PROJECT_TYPES,
} from "@/db/schema"
import type {
  RankedProject,
  Rankings,
} from "@/lib/github/service/rankings"

const isoDateTime = z.iso.datetime().describe("ISO 8601 时间戳")

/** `apiError()` 的形状：所有需要凭据的端点失败时都是它。 */
export const errorBodySchema = z.object({
  error: z.object({
    code: z.string().describe("稳定的错误码，判断分支只应依赖它"),
    message: z.string().describe("给人看的说明，可以改"),
    detail: z.string().optional().describe("补充信息，例如 schema 的第一个问题"),
  }),
})

/**
 * 回调参数：登记与发布两个写入端点都带。
 *
 * **给了 `callbackUrl` 就必须给 `callbackSecret`。** 少一个就 400，而不是替你
 * 挑一个默认密钥：默认密钥只能是我们的某个常量或者你的 key 的某种派生，前者
 * 等于把签名公开给所有人，后者会把 API 凭据的寿命绑到回调上——回调地址换了、
 * 轮换了，key 也得跟着换。
 */
const callbackFields = {
  callbackUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "落库完成后回调一次的地址。成功与幂等命中都会回调；请求本身非法时直接返回错误，不回调"
    ),
  callbackSecret: z
    .string()
    .min(16)
    .optional()
    .describe(
      "回调签名密钥，至少 16 字节熵。给了 callbackUrl 就必须给，否则 400"
    ),
}

/**
 * 登记端点的形态一：只给一个 GitHub 地址。
 *
 * **不接收调用方带来的 GitHub 数据。** 调用方手上那份星标数、语言、topics 是
 * 它自己某一时刻的快照，让它落库等于让雷达的统计建立在一个可能过期的副本上；
 * 由服务端自己去取，多一次请求换来「库里那份和 GitHub 上一致」。
 */
export const repoUrlRegisterSchema = z
  .object({ url: z.string().min(1), ...callbackFields })
  .strict()

/** 登记端点的形态二：`owner/repo`。给不了完整 URL 时用它。 */
export const repoSlugRegisterSchema = z
  .object({
    repo: z.string().min(3).describe("`owner/name`，正好一个斜杠"),
    ...callbackFields,
  })
  .strict()

/**
 * 登记端点的两种形态，二选一。
 *
 * 两个成员都是 `.strict()`：多一个不认识的字段（比如 `type`）整条会被拒掉，
 * 而不是被忽略。两个都 `.strict()` 的另一个作用是「`url` 与 `repo` 都给」会被
 * 两侧同时拒绝——二选一由 union 自己保证，不需要额外写一条 refine。
 */
export const repoRegisterRequestSchema = z.union([
  repoUrlRegisterSchema,
  repoSlugRegisterSchema,
])

/**
 * 发布端点的请求体。`type` 缺省为 `application`。
 *
 * 与登记端点同一种地址形态（`url` 或 `repo`），回调参数也一致：回调的是「发布
 * 完成」，而发布要跑 README 解析、技能翻译与投递，比登记慢得多，正是需要回调
 * 的那种长任务。
 */
export const projectRequestSchema = z
  .object({
    url: z.string().min(1).optional().describe("形态一：GitHub 仓库地址"),
    repo: z.string().min(3).optional().describe("形态二：`owner/name`"),
    type: z.enum(PROJECT_TYPES).optional(),
    ...callbackFields,
  })
  .strict()
  .refine((value) => Boolean(value.url) !== Boolean(value.repo), {
    message: "url 与 repo 二选一，不能同时给",
  })

/** `POST /api/v1/repos` 的成功响应。`created: false` 表示幂等命中。 */
export const repoRegisteredSchema = z.object({
  ok: z.literal(true),
  repo: z.object({
    id: z.string(),
    full_name: z.string(),
    stars: z.number().nullable().describe("尚未采集到星标数时为 null"),
  }),
  created: z.boolean().describe("true = 新登记，false = 这个仓库本来就在跟踪"),
  projectCount: z
    .number()
    .describe("已发布的项目数。非零意味着这个仓库先前被策展过，本次的 type 被忽略"),
})

/** `POST /api/v1/projects` 里技能投递的计数。没有下游配置时整个字段不出现。 */
export const projectDeliverySchema = z.object({
  found: z.number(),
  pushed: z.number(),
  failed: z.number(),
})

/** `POST /api/v1/projects` 的成功响应。 */
export const projectCreatedSchema = z.object({
  ok: z.literal(true),
  status: z.enum(["created", "existing"]),
  repo: z.object({ full_name: z.string() }),
  project: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    type: z.enum(PROJECT_TYPES),
    status: z.string(),
    description: z.string(),
  }),
  readme: z.object({
    synced: z.boolean(),
    error: z.string().optional(),
  }),
  skills: z
    .object({
      count: z.number(),
      translated: z.number(),
      empty: z.boolean(),
    })
    .nullable()
    .describe("只有 type=skill 才同步技能文档；其余类型为 null"),
  authorLinked: z.boolean(),
  delivered: z
    .boolean()
    .nullable()
    .describe("null = 这个部署没配下游，不是失败"),
  delivery: projectDeliverySchema.optional(),
})

/** 榜单行上的那一条异动，取最严重的那个。 */
export const rankedAnomalySchema = z.object({
  kind: z.enum(ANOMALY_KINDS),
  severity: z.enum(ANOMALY_SEVERITIES),
  title: z.string(),
})

/** 一条上榜项目，周榜、月榜、相对增速榜共用同一种记录。 */
export const rankedProjectSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  description: z.string(),
  stars: z.number(),
  delta: z.number().describe("本周期内新增的星标数"),
  relativeGrowth: z
    .number()
    .nullable()
    .describe("周期前星标数为 0 时为 null，而不是 Infinity"),
  tags: z.array(z.string()),
  ownerId: z.number(),
  createdAt: isoDateTime,
  logo: z.string().nullable(),
  iconUrl: z.string().nullable(),
  avatar: z.string().nullable(),
  anomaly: rankedAnomalySchema.nullable(),
})

/**
 * `GET /api/v1/rankings/weekly` 与 `/monthly` 的响应体，两个周期结构一致。
 *
 * 设计文档 §5.1 要求「返回沿用 `Rankings`」：站内榜单页、排行任务与开放 API 共用
 * 这一份形状，所以这里既没有为 v1 另立一套字段，也没有丢掉 `period` —— 缺省参数
 * 命中「最近一个完整周期」时，调用方要能从响应里看出自己拿到的是哪一期。
 */
export const rankingsSchema = z.object({
  period: z.enum(["week", "month"]),
  year: z.number(),
  week: z.number().optional(),
  month: z.number().optional(),
  trending: z.array(rankedProjectSchema).describe("按 delta 降序，最多 100 条"),
  byRelativeGrowth: z.array(rankedProjectSchema),
})


/* ───────────────────── 读取 API（设计文档 §1.1 / §4 / §5） ───────────────────── */

/**
 * 一个仓库的分类四轴（设计文档 §1.5）。
 *
 * 四条轴不是同一件事的四种叫法，所以逐条输出、不合并：`type` 是形态（人工填），
 * `category` 是运营分类（`classify-projects` 提议 + 运营确认），`tags` 是读者检索词
 * （来自 GitHub topics），`platformStatus` 是仓库在平台上的位置。
 *
 * **未策展的仓库这四个字段必然是空值**（`categoryCode: null`、其余为 `[]`）——
 * 分类是策展的产物，不是数据缺失。消费方若拿 `categoryCode IS NOT NULL` 做二次
 * 筛选，会把所有未策展仓库悄悄丢掉。
 */
export const classificationSchema = z.object({
  projectTypes: z
    .array(z.enum(PROJECT_TYPES))
    .describe("该仓库所有已发布项目的 type，可能多个；未策展时为空数组"),
  categoryCode: z
    .string()
    .nullable()
    .describe("categories.code；未策展时为 null"),
  categoryReviewed: z
    .boolean()
    .describe("分类是否已由运营确认，未策展时为 false"),
  isPlatformProject: z
    .boolean()
    .describe("是否存在未被隐藏的 project 行（公开页据此判定可见）"),
  platformStatus: z.enum(["pending", "tracked", "curated", "archived"]),
  tags: z.array(z.string()).describe("公开站 /categories 的唯一分类轴"),
})

/**
 * `GET /api/v1/repos` 的一行。
 *
 * 字段取自 `repos` 行加上 §1.5 的分类四轴——过滤器（§6.6）就是拿这四轴判定的，
 * 所以列表里必须带它们：调用方要能自己验一遍「为什么这个仓库命中了」。
 */
export const repoListItemSchema = z.object({
  id: z.string().describe("repos.id（nanoid），也可以直接当 {id} 传给详情与统计"),
  fullName: z.string().describe("`owner/name`"),
  description: z.string().nullable(),
  repoUrl: z.string(),
  topics: z.array(z.string()),
  languages: z.array(z.string()),
  licenseSpdxId: z.string().nullable(),
  stars: z.number().nullable().describe("尚未采集到星标数时为 null"),
  forks: z.number().nullable(),
  subscribersCount: z
    .number()
    .nullable()
    .describe("GitHub 的 watch（通知订阅）人数，不是 star 数——两个词在 GitHub API 里含义相反"),
  openIssuesCount: z.number().nullable(),
  defaultBranch: z.string().nullable(),
  archived: z.boolean(),
  createdAt: isoDateTime,
  pushedAt: isoDateTime.nullable(),
  lastCommit: isoDateTime.nullable(),
  classification: classificationSchema,
  /** 已发布的项目数。非零意味着这个仓库被策展过（提交本身不会建 project 行）。 */
  projectCount: z.number(),
})

/**
 * `GET /api/v1/repos` 的响应。
 *
 * **游标是 keyset 而不是 offset**：`cursor` 编码的是上一页最后一个 `id`，下一页取
 * `id > cursor`。offset 在两次请求之间会因为新登记的仓库被插进来而让同一行出现两次
 * 或者被跳过；而 keyset 不会——它只依赖 `id` 的大小关系（§3.7）。
 *
 * 排序键 `id` 对客户端是**不透明**的（nanoid 风格的 base64url，看不出大小序），所以
 * 游标必须是服务端发的那个串，不能让调用方自己拼。
 */
export const repoListSchema = z.object({
  repos: z.array(repoListItemSchema),
  /** 下一页的起点；`null` 表示这是最后一页。 */
  nextCursor: z.string().nullable(),
  /** 命中的总数。不受 `limit` 影响，调用方据此判断"该不该继续翻"。 */
  total: z.number().describe("命中过滤器的仓库总数，与 limit 无关"),
})

/** 仓库档案：列表项的全部字段，加上 GitHub 的补充事实（§3.6）。 */
export const repoProfileSchema = repoListItemSchema.extend({
  owner: z.string(),
  ownerId: z.number(),
  name: z.string(),
  homepage: z.string().nullable(),
  contributorCount: z.number().nullable(),
  commitCount: z.number().nullable(),
  mentionableUsersCount: z.number().nullable(),
  pullRequestsCount: z.number().nullable(),
  releasesCount: z.number().nullable(),
  latestReleaseName: z.string().nullable(),
  latestReleaseTagName: z.string().nullable(),
  latestReleasePublishedAt: isoDateTime.nullable(),
  latestReleaseUrl: z.string().nullable(),
  openGraphImageUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
})

/**
 * 统计的一期（设计文档 §4.1）。
 *
 * 三个周期标签恒定输出、不适用的为 `null`，这样客户端不必按 `cadence` 分支解析。
 *
 * **`total_*` / `delta_*` 的 `null` 一律原样透传，不转 0**：`null` 的含义是
 * 「这个周期没有采集」，转成 0 会变成「采集到 0」。窗口内没有行的那些天**不补洞**，
 * 直接不出现——「没量过」和「量到 0」是两件事（设计文档 §1.3 / §4.1）。
 */
export const statsPeriodSchema = z.object({
  period: isoDateTime.describe("该日历边界对应的瞬间，按 Asia/Shanghai 解释，不是 UTC 零点"),
  date: z
    .string()
    .nullable()
    .describe("daily 才有：Asia/Shanghai 日历日，如 2026-04-01"),
  yearWeek: z.string().nullable().describe("weekly 才有：ISO 周，如 2026-W14"),
  yearMonth: z.string().nullable().describe("monthly 才有：年月，如 2026-03"),
  totalStars: z.number().nullable(),
  deltaStars: z.number().nullable().describe("净变化"),
  deltaNewStars: z
    .number()
    .nullable()
    .describe("毛新增，与 deltaStars 是两个量，两个都保留"),
  totalWatchers: z.number().nullable().describe("GitHub watch（通知订阅）人数"),
  deltaWatchers: z.number().nullable(),
  totalForks: z.number().nullable(),
  deltaForks: z.number().nullable(),
  totalOpenIssues: z.number().nullable(),
  deltaOpenIssues: z.number().nullable(),
  totalPullRequests: z.number().nullable(),
  deltaPullRequests: z.number().nullable(),
  totalReleases: z.number().nullable(),
  deltaReleases: z.number().nullable(),
  totalContributors: z.number().nullable(),
  deltaContributors: z.number().nullable(),
  totalCommits: z.number().nullable(),
  deltaCommits: z.number().nullable(),
  totalDownloads: z.number().nullable().describe("非 npm 仓库恒为 null"),
  deltaDownloads: z.number().nullable(),
})

/**
 * `GET /api/v1/repos/{id}` 的响应：档案 + 最近一期统计。
 *
 * 最近一期取的是**已经存下来的最后一期**，不是昨天：采集任务随时可能停，按日历
 * 今天取会返回一串「最后有数据的那天 → 今天」的空洞，而空洞在图上和「这几天真的
 * 没人 star」无法区分（设计文档 §4.1）。
 */
export const repoDetailSchema = z.object({
  repo: repoProfileSchema,
  latestStats: z.object({
    daily: statsPeriodSchema.nullable(),
    weekly: statsPeriodSchema.nullable(),
    monthly: statsPeriodSchema.nullable(),
  }),
})

/** `GET /api/v1/repos/{id}/stats` 的响应体（设计文档 §4.1）。 */
export const repoStatsRangeSchema = z.object({
  repoId: z.string(),
  fullName: z.string(),
  cadence: z.enum(["daily", "weekly", "monthly"]),
  timezone: z.literal("Asia/Shanghai"),
  range: z.object({
    start: isoDateTime,
    end: isoDateTime.describe("该仓库最新已存周期，不 clamp 到今天"),
  }),
  counts: z.object({
    periods: z.number().describe("窗口内已存的期数"),
    returned: z.number(),
    hasMore: z.boolean(),
  }),
  periods: z.array(statsPeriodSchema),
  nextCursor: z.string().nullable(),
})

/**
 * `GET /api/v1/rankings/periods` 的响应体（设计文档 §5.2）。
 *
 * 期目沿用 `listWeeklyPeriods` / 月榜同类函数的形状（`{ year, week }`），**不带条数**——
 * 「这一期有没有数据」由「它有没有出现在列表里」表达，多一个 count 只会让人以为
 * 漏了它就等于 0 行。
 */
export const periodCatalogSchema = z.object({
  cadence: z.enum(["weekly", "monthly"]),
  periods: z.array(
    z.union([
      z.object({ year: z.number(), week: z.number() }),
      z.object({ year: z.number(), month: z.number() }),
    ])
  ),
})

/* ───────────────────────── 订阅（设计文档 §6） ───────────────────────── */

/** 订阅推什么内容。与 key 的 scope 是两回事：key 管「能不能管订阅」，订阅管「推什么」。 */
export const SUBSCRIPTION_SCOPES = [
  "repos.stats",
  "repos.rankings",
  "repos.metadata",
] as const

/**
 * 订阅过滤器（设计文档 §6.2 / §6.6）。
 *
 * 求值顺序是「先命中即短路」，语义上等价于 OR，顺序固定为：
 *
 * 1. `repoIds` 非空 → 完全绕过下面所有规则；
 * 2. 自己的提交 且 `includeOwnSubmissions`；
 * 3. 是平台项目 且 `includePlatformProjects`；
 * 4. 有 project 行 且 `categoryCodes` 命中；
 * 5. 有 project 行 且 `projectTypes` 命中；
 * 6. 无 project 行 且 `includeUncurated`；
 * 7. 其他 → 不推。
 *
 * **`projectTypes` / `categoryCodes` 一旦非空，所有未策展仓库会被静默排除**，
 * 所以 `includeUncurated` 的默认值按条件推导（见
 * {@link subscriptionRequestSchema} 的说明），而不是固定 `false`。
 */
export const subscriptionFiltersSchema = z.object({
  repoIds: z
    .array(z.string())
    .optional()
    .describe("显式白名单。给了就完全覆盖其余过滤器，优先级最高也最容易解释"),
  projectTypes: z
    .array(z.enum(PROJECT_TYPES))
    .optional()
    .describe("项目形态。取值 client/server/application/skill/persona"),
  categoryCodes: z
    .array(z.string())
    .optional()
    .describe("运营分类 categories.code，与形态是两条正交的轴，不要混用"),
  includePlatformProjects: z
    .boolean()
    .optional()
    .describe("是否纳入有未隐藏 project 行的仓库（策展动作因此对外可见）"),
  includeUncurated: z
    .boolean()
    .optional()
    .describe("是否纳入还没有 project 行的候选仓库。它们必然没有分类"),
  includeOwnSubmissions: z
    .boolean()
    .optional()
    .describe("是否纳入该主体自己提交过的仓库"),
})

/** `POST /api/v1/subscriptions` 的请求体（设计文档 §6.2）。 */
export const subscriptionRequestSchema = z.object({
  name: z.string().min(1).max(120).describe("只给自己看，用来分辨多条订阅"),
  callbackUrl: z.string().url().describe("接收 payload 的地址；投递时按 §3.5 的签名规则"),
  cadence: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  scopes: z.array(z.enum(SUBSCRIPTION_SCOPES)).min(1),
  filters: subscriptionFiltersSchema.default({}),
  mode: z
    .enum(["batch", "snapshot"])
    .default("batch")
    .describe("batch 按水位线增量推；snapshot 每次推范围内全部最新一期"),
  expiresAt: isoDateTime.optional(),
})

/**
 * 订阅对象。
 *
 * 订阅**没有自己的密钥**：验签密钥由 `api_key_id` 那把 key 派生，所以这里只带一个
 * 人工前缀（签名 key 的 `prefix`）用来分辨"用哪把 key 签的"，而密钥本身出现在
 * 创建响应与详情里（`signingKey`，可重算，不设"只此一次"的仪式）。
 */
export const subscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  callbackUrl: z.string(),
  signingKeyPrefix: z.string().describe("签名 key 的前缀，仅供人工比对，不是密钥"),
  cadence: z.enum(["daily", "weekly", "monthly"]),
  mode: z.enum(["batch", "snapshot"]),
  scopes: z.array(z.enum(SUBSCRIPTION_SCOPES)),
  filters: subscriptionFiltersSchema,
  filtersVersion: z
    .number()
    .describe("过滤器每次变更 +1；消费方据此区分「新数据」与「改过滤器后的补发」"),
  enabled: z.boolean(),
  disabledReason: z
    .enum(["too_many_failures", "admin"])
    .nullable()
    .describe("连续失败到熔断是 too_many_failures；管理员停用是 admin"),
  watermark: isoDateTime
    .nullable()
    .describe("batch 模式读到哪一期了。投递成功才推进，失败不动"),
  createdAt: isoDateTime,
  expiresAt: isoDateTime.nullable(),
})

/**
 * 创建订阅的响应：多一个 `signingKey`。
 *
 * 它是那把签名 key 的确定性派生（`deriveSigningKey`），能随时从详情里再取，所以
 * 这里不是"仅此一次"—— 接收方要它是为了配自己的验签，而不是把它当凭据保管。
 */
export const subscriptionCreatedSchema = subscriptionSchema.extend({
  signingKey: z
    .string()
    .describe("验签密钥。同一把签名 key 名下的所有订阅共用；由 key 派生，可随时重取"),
})

/** `GET /api/v1/subscriptions` 的响应体。 */
export const subscriptionListSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
  count: z.number(),
})

/** 一次投递的记录（设计文档 §6.8，最近 20 条）。 */
export const deliveryRecordSchema = z.object({
  eventId: z.string().describe("幂等键。重试不变，接收方按它去重"),
  status: z.enum(["pending", "delivered", "failed"]),
  attempt: z.number(),
  httpStatus: z.number().nullable(),
  error: z.string().nullable(),
  createdAt: isoDateTime,
})

/**
 * `GET /api/v1/subscriptions/{id}` 的响应体。
 *
 * 后半段是给订阅方排障用的：不给投递状态，订阅方唯一的手段就是「等明天看数据有没有
 * 更新」（设计文档 §6.8）。
 */
export const subscriptionDetailSchema = subscriptionSchema.extend({
  signingKey: z
    .string()
    .describe("验签密钥。与创建响应里的是同一个值，丢了从这里重取即可"),
  matchedRepos: z
    .number()
    .describe("当前过滤器命中的仓库数。为 0 时水位线既不推进也不回退（§6.4）"),
  lastDeliveredAt: isoDateTime.nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number(),
  deliveries: z.array(deliveryRecordSchema).describe("最近 20 条，按时间倒序"),
})

/**
 * `PATCH /api/v1/subscriptions/{id}` 的请求体（设计文档 §1.1 / §6.4）。
 *
 * 命中任何过滤字段时，服务端在同一个事务里给 `filtersVersion` 加一，并把水位线**回退**
 * 到「新命中集合的最早已存周期」，让新纳入的仓库至少被完整推一次——否则它们的历史
 * 早于水位线，就永远收不到。
 */
export const subscriptionUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  callbackUrl: z.string().url().optional(),
  filters: subscriptionFiltersSchema.optional(),
  scopes: z.array(z.enum(SUBSCRIPTION_SCOPES)).min(1).optional(),
  enabled: z.boolean().optional().describe("false = 暂停（队列保留），true = 恢复"),
  expiresAt: isoDateTime.nullable().optional(),
})

/**
 * `POST /api/v1/subscriptions/{id}/test` 的响应（设计文档 §6.8）。
 *
 * 探测事件**不推进水位线**：它的用途是改过滤器时立刻验证回调地址可达、签名能过，
 * 而不是补数据。鉴权与签名路径和正常投递完全一致，所以测试能验签通过，正常事件也能。
 */
export const subscriptionTestSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  delivered: z.boolean(),
  httpStatus: z.number().nullable(),
  error: z.string().nullable(),
  deliveredAt: isoDateTime,
})

/**
 * 把 `Rankings` 变成 `rankingsSchema` 的输出形状。
 *
 * 唯一的动作是 `createdAt`：服务层给的是 `Date`，契约给的是 ISO 字符串。
 * `JSON.stringify` 对 `Date` 做的本来就是这件事，所以客户端看到的字节完全一样。
 */
export function rankingsPayload(
  rankings: Rankings
): z.output<typeof rankingsSchema> {
  const row = (project: RankedProject) => ({
    ...project,
    createdAt: project.createdAt.toISOString(),
  })
  return {
    ...rankings,
    trending: rankings.trending.map(row),
    byRelativeGrowth: rankings.byRelativeGrowth.map(row),
  }
}

/* ------------------------------------------------------------------ *
 * `POST /api/v1/skills/scan`
 *
 * 内部端点（Web → Console），scope `skills:scan`。契约里刻意只有**请求**而没有
 * 响应 schema：响应里的 `flags` 是 `@workspace/security-scan` 的
 * `SecurityFlagHit[]`，而那个包的 `types.ts` 才是它唯一的真相来源。在这里再抄
 * 一份 `securityFlagHitSchema` 就是下一次漂移的起点——OpenAPI 里用一个
 * 宽松的 object 指过去，并在 `description` 里写明权威位置。
 * ------------------------------------------------------------------ */

/** `owner/repo`，正好一个斜杠，斜杠两侧非空。 */
const repoSlugSchema = z
  .string()
  .regex(/^[^/\s]+\/[^/\s]+$/, "必须是 owner/repo")
  .describe("GitHub 仓库全名，例如 anthropics/skills")

/**
 * 扫描请求。
 *
 * **不给文件，只给地址。** Console 自己取源码是有意的：调用方手里那份文件快照
 * 是它自己某一时刻的副本，让它落进扫描结论等于让"同一个提交"在两次扫描里得到
 * 两个不同的结果。地址相同 → 取到的提交相同 → 结论相同，这条链不能从中间断。
 *
 * `ref` 缺省即仓库默认分支。`skillDir` 缺省即整个仓库：多数 Skill 仓库的
 * `SKILL.md` 就在根目录，而猜一个子目录前缀猜错的表现是"扫了个空目录并报告
 * 干净"。
 */
export const skillScanRequestSchema = z
  .object({
    repoFullName: repoSlugSchema,
    ref: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("分支、tag 或 commit sha。缺省取默认分支"),
    skillDir: z
      .string()
      .min(1)
      .max(400)
      .optional()
      .describe("仓库内的相对目录，例如 `skills/pdf`。缺省扫描整个仓库"),
    /** 是否跑阶段 2 的 LLM 复核。缺省 true——只跑规则会把 `unsafe` 读成结论。 */
    includeLlm: z.boolean().optional().describe("缺省 true"),
  })
  .strict()

/**
 * `POST /api/v1/skills/scan` 的响应。
 *
 * 结构与 `@workspace/security-scan` 的 `types.ts` 一一对应——`flags` 是
 * `SecurityFlagHit[]`、`context` 是 `ScanContext`、`llmAnalysis` 是 `LlmAnalysis`。
 * 这里是那套类型的**消费者**而不是它的第二份定义：改动规则包时不许先改这里。
 * `flags` 的字段写得略有差别（`file`/`line` 可选、`severity` 收窄到实际出现的四档），
 * 因为那是 z.toJSONSchema 能表达的极限；权威定义始终回指规则包。
 */
const scanContextSchema = z
  .object({
    owner: z.string().nullable().optional(),
    homepage: z.string().nullable().optional(),
    stars: z.number().nullable().optional(),
    license: z.string().nullable().optional(),
  })
  .describe("来源：@workspace/security-scan/src/types.ts 的 ScanContext")

const securityFlagHitSchema = z
  .object({
    name: z.string(),
    severity: z.enum(["critical", "high", "medium", "low"]),
    description: z.string(),
    file: z.string().optional(),
    line: z.number().optional(),
    snippet: z.string().optional(),
    inCodeBlock: z.boolean().optional(),
    citedOrNegated: z.boolean().optional(),
  })
  .describe("来源：@workspace/security-scan/src/types.ts 的 SecurityFlagHit")

export const skillScanResponseSchema = z.object({
  repoFullName: z.string(),
  skillDir: z.string().optional(),
  ref: z.string().optional(),
  source: z.enum(["local-clone", "vercel-sandbox", "vercel-sandbox-serverless"]),
  context: scanContextSchema,
  grade: z.enum(["safe", "caution", "unsafe", "reject", "unknown"]),
  flags: z.array(securityFlagHitSchema),
  trustTier: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  llmGrade: z
    .enum(["safe", "caution", "unsafe", "reject", "unknown"])
    .optional()
    .describe("阶段 2 的评级；跳过阶段 2 时缺省"),
  llmAnalysis: z
    .unknown()
    .optional()
    .describe("阶段 2 的完整分析。来源：@workspace/security-scan 的 LlmAnalysis"),
  scannedAt: isoDateTime,
  rulesVersion: z.string().describe("本次执行所用的规则版本，例如 v1.0.0"),
  fileCount: z.number(),
  truncated: z.boolean().describe("是否在达到文件/体积上限后提前停止"),
  truncatedReason: z
    .string()
    .optional()
    .describe("`max_files` / `max_total_bytes` / `file_too_large`"),
  files: z.array(z.object({ path: z.string(), size: z.number() })),
})
