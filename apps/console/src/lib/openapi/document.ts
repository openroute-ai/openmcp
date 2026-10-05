/**
 * OpenAPI 3.1 文档，由 `lib/api/contract.ts` 里的 zod schema 聚合而成。
 *
 * 这是 VercelAI 雷达唯一的开放 API 面：所有端点都在 `/api/v1` 之下、都要
 * `Authorization: Bearer <key>`，没有免鉴权旁路。覆盖范围以
 * `docs/design/CONSOLE_OPEN_RADAR_API.md` §1.1 的路由清单为准——读取、写入、
 * 订阅，外加那份自描述端点。
 *
 * 三个读者：`GET /openapi.json` 把它原样吐给客户端；`scripts/generate-openapi-docs.ts`
 * 把它变成 `content/docs/api/` 下的逐端点页面；页面本身也用它渲染。
 *
 * 字段全部来自 schema，这里只写 schema 表达不了的东西：状态码、scope、限流头，
 * 以及每句话的中文解释。
 */
import type {
  Document,
  HttpMethods,
  OpenAPIV3_2,
  OperationObject,
  ParameterObject,
  PathItemObject,
  ReferenceObject,
  ResponseObject,
  SecuritySchemeObject,
} from "fumadocs-openapi"
import { z } from "zod"
import {
  classificationSchema,
  errorBodySchema,
  pairingRedeemRequestSchema,
  pairingRedeemResponseSchema,
  periodCatalogSchema,
  projectCreatedSchema,
  projectRequestSchema,
  rankedAnomalySchema,
  rankedProjectSchema,
  repoSlugRegisterSchema,
  repoUrlRegisterSchema,
  rankingsSchema,
  repoDetailSchema,
  repoListItemSchema,
  repoListSchema,
  repoRegisteredSchema,
  repoRegisterRequestSchema,
  repoStatsRangeSchema,
  statsPeriodSchema,
  subscriptionCreatedSchema,
  subscriptionDetailSchema,
  subscriptionFiltersSchema,
  subscriptionListSchema,
  subscriptionRequestSchema,
  subscriptionRotatedSchema,
  subscriptionSchema,
  subscriptionTestSchema,
  subscriptionUpdateSchema,
  deliveryRecordSchema,
} from "@/lib/api/contract"
import { SITE_NAME, SITE_ORIGIN } from "@/lib/config/site"

type SchemaObject = OpenAPIV3_2.SchemaObject
type MaybeRef = ReferenceObject | SchemaObject
type Content = NonNullable<ResponseObject["content"]>

/**
 * 3.1.0，而不是包装库默认的 3.2.0：这份文档只用到 3.1 的特性，而 3.1 是当前被
 * 工具链支持得最广的版本。
 *
 * `paths` 收窄成 `ContractPathItem`，好让 `x-nav-description` 在这份文档上仍然
 * 读得出来（`Document` 那一侧是 `PathItemObject`，索引一个 `x-` 键会报错）。
 */
type ContractDocument = Omit<Document, "openapi" | "paths"> & {
  openapi: "3.1.0"
  paths?: Record<string, ContractPathItem>
}

/**
 * operation 上多一个 `x-nav-description`：**一句话概要**。
 *
 * OpenAPI 允许 `x-` 开头的 vendor extension，这里用它把「导航用的概要」与
 * operation 自己的 `description` 分开：
 *
 * - `description` 是给通读这一页的人看的散文（行为、陷阱、`§x.y` 出处），它渲染在
 *   正文里，也原样出现在 `/openapi.json` 与 `llms-full.txt`；
 * - `x-nav-description` 是给扫一眼的人看的：frontmatter `description`、页脚的
 *   「上一页 / 下一页」摘要、`<meta description>` 都取它（见
 *   `scripts/generate-openapi-docs.ts`）。页脚那一行只有单行宽度，塞不进散文。
 *
 * 之所以贴在 operation 上而不是另开一张 operationId → 文案的表：散文挪了段落、
 * 概要忘了改，页脚就会说错这一页讲什么，而这种错没人看得出来——它只是读着有点
 * 不对劲。改文案时两行挨在一起，那件事就不会发生。
 *
 * `PathItemObject` 自带的 `T` 泛型本来就是给 extension 留的，但 `paths` 那张表
 * 用的是它的默认 `{}`（多一个键就是 TS 报错），所以这里自己声明一份，不去改
 * fumadocs 的类型。
 */
type ContractOperation = OperationObject & { "x-nav-description"?: string }

type ContractPathItem = Omit<PathItemObject, HttpMethods> & {
  [method in HttpMethods]?: ContractOperation
}

const ref = (path: string): ReferenceObject => ({ $ref: path })

/**
 * zod → JSON Schema。
 *
 * `io` 决定看哪一侧：请求体用 `input`（`isoDateTime` 这类字段的 transform 只有
 * input 侧能表示），响应用 `output`。
 * `$schema` 从结果里删掉——OpenAPI 的 Schema Object 不带它。
 */
function jsonSchema(schema: z.ZodType, io: "input" | "output"): SchemaObject {
  const out = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
  }) as Record<string, unknown>
  delete out.$schema
  return out as SchemaObject
}

function jsonContent(schema: MaybeRef): Content {
  return { "application/json": { schema } }
}

function response(description: string, schema: MaybeRef): ResponseObject {
  return { description, content: jsonContent(schema) }
}

const errorBody = jsonSchema(errorBodySchema, "output")

/** `apiError()` 的 401：没带 key、已吊销、已过期，都会带 `WWW-Authenticate`。 */
const unauthorized: ResponseObject = {
  description:
    "缺少 Authorization、key 已吊销（key_revoked）或已过期（key_expired）",
  headers: {
    "WWW-Authenticate": {
      description: "Bearer challenge",
      schema: { type: "string" },
    },
  },
  content: jsonContent(errorBody),
}

/** 路由不存在与 key 查不到故意同码，见 `guard.ts`。 */
const notFound: ResponseObject = {
  description: "key 查不到（not_found）。路由不存在也是这个响应",
  content: jsonContent(errorBody),
}

const rateLimited: ResponseObject = {
  description: "撞上分钟窗口或当天窗口的配额（rate_limited）",
  headers: {
    "Retry-After": ref("#/components/headers/Retry-After"),
    "Ratelimit-Limit": ref("#/components/headers/Ratelimit-Limit"),
    "Ratelimit-Remaining": ref("#/components/headers/Ratelimit-Remaining"),
    "Ratelimit-Reset": ref("#/components/headers/Ratelimit-Reset"),
  },
  content: jsonContent(errorBody),
}

function insufficientScope(scope: string): ResponseObject {
  return {
    description: `key 有效但没有这个接口要的 scope（insufficient_scope，需要 ${scope}）`,
    headers: {
      "WWW-Authenticate": {
        description: "Bearer challenge",
        schema: { type: "string" },
      },
    },
    content: jsonContent(errorBody),
  }
}

/** 需要凭据的端点的 400，错误体是 `errorBodySchema`。 */
function v1BadRequest(codes: string, hint: string): ResponseObject {
  return { description: `${codes}：${hint}`, content: jsonContent(errorBody) }
}

const githubUnavailable: ResponseObject = {
  description: "这个部署没配 GitHub 凭据（github_unavailable）",
  content: jsonContent(errorBody),
}

/**
 * `Idempotency-Key` 请求头（§3.3）。
 *
 * 上界写在这里，因为它真的存在：`idempotencyKeyOf` 对超长的 key 当作**没带**处理，而不是
 * 400。这个头的唯一合法用途是"客户端生成的稳定字符串"，而一个 8KB 的 key 不可能是忘了
 * 截断的 uuid —— 所以拒绝它更可能是调用方的生成方式有问题，而那被一个 400 掩盖成"重试
 * 也许能过"。语义因此是：过长 = 不启用幂等。
 */
const idempotencyKeyParam: ParameterObject = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "客户端生成的稳定字符串（建议 uuid）。给了就启用幂等：同 key + 同请求体回放上次的" +
    "状态码与响应体（响应体按 JSON 语义相同，键序可能与首次不同）；同 key + 不同请求体 " +
    "409 `idempotency_key_reuse`；同 key 的另一个" +
    "请求仍在跑 409 `idempotency_in_flight` + `Retry-After`。只有成功会被记住，" +
    "24 小时后过期。超过 200 字符视作未带",
  schema: { type: "string", maxLength: 200 },
}

/** 409 的两个幂等分支共用（§3.3）。 */
const idempotencyConflict = (code: string, hint: string): ResponseObject => ({
  description: `${code}：${hint}`,
  headers: { "Retry-After": ref("#/components/headers/Retry-After") },
  content: jsonContent(errorBody),
})

const bearerAuth: SecuritySchemeObject = {
  type: "http",
  scheme: "bearer",
  bearerFormat: "mcp_radar_<prefix>_<secret>",
  description:
    "`Authorization: Bearer <key>`。key 由控制台自助签发，或管理员在 /dashboard 代签",
}

const yearParam: ParameterObject = {
  name: "year",
  in: "query",
  required: false,
  description: "四位年份。缺省为最近一个完整周期",
  schema: { type: "integer" },
}


/* ── `/api/v1` 的公共零件 ───────────────────────────────────────────── */


/** 列表类端点的游标。`nextCursor` 为 null 时没有下一页。 */
const cursorParam: ParameterObject = {
  name: "cursor",
  in: "query",
  required: false,
  description: "上一页响应里的 `nextCursor`",
  schema: { type: "string" },
}

/**
 * `limit` 参数。
 *
 * 上界只在设计文档给了的地方才写：统计端点明确是 `1..1000`（§4.1），排行与周期
 * 目录只给了缺省值，没给上界——那就只写缺省值，凭空补一个 `maximum` 会让客户端
 * 以为那是契约。
 */
const limitParam = (fallback: number, max?: number): ParameterObject => ({
  name: "limit",
  in: "query",
  required: false,
  description:
    max === undefined
      ? `返回条数上限，缺省 ${fallback}`
      : `返回条数上限，缺省 ${fallback}，最大 ${max}`,
  schema:
    max === undefined
      ? { type: "integer", minimum: 1 }
      : { type: "integer", minimum: 1, maximum: max },
})

/** `{id}` 在仓库那几条路由里接受两种写法（设计文档 §4.1）。 */
const repoIdParam: ParameterObject = {
  name: "id",
  in: "path",
  required: true,
  description:
    "`repos.id`（nanoid），或 `owner/name`——后者要 URL 编码成 `owner%2Fname`",
  schema: { type: "string" },
}

const subscriptionIdParam: ParameterObject = {
  name: "id",
  in: "path",
  required: true,
  description: "订阅 id（`subscriptions.id`）",
  schema: { type: "string" },
}

/**
 * 布尔过滤器在 query 里怎么传。
 *
 * 只有 `true` / `false` 两个字面量，不接受 `1`、`yes`、空串——过滤器的默认值是
 * 按条件推导出来的（§6.6 陷阱一），多一种写法就多一种「看起来是 true 其实是
 * 走了默认值」的路径。
 */
function flagParam(
  name: string,
  description: string,
  defaultValue?: boolean
): ParameterObject {
  return {
    name,
    in: "query",
    required: false,
    description: defaultValue === undefined ? description : `${description}。缺省 ${defaultValue}`,
    schema: { type: "boolean" },
  }
}

/** 枚举列表过滤器：逗号分隔，重复出现也可以。 */
function listParam(
  name: string,
  description: string,
  items: string[]
): ParameterObject {
  return {
    name,
    in: "query",
    required: false,
    description: `${description}。逗号分隔，如 \`${items.join(",")}\``,
    schema: { type: "string" },
  }
}

const projectTypeValues = [
  "client",
  "server",
  "application",
  "skill",
  "persona",
]

/** 读取类端点的错误集合：鉴权四件 + 参数不合法。 */
function readFailures(scope: string): Record<string, ResponseObject> {
  return {
    "400": v1BadRequest("invalid_body", "查询参数不合法（枚举值、范围或时间格式）"),
    "401": unauthorized,
    "403": insufficientScope(scope),
    "404": notFound,
    "429": rateLimited,
  }
}

/** 订阅类端点的错误集合。归属不对与不存在同码，不泄漏「这把订阅存在」。 */
function subscriptionFailures(
  hint: string,
  scope = "subscriptions:write"
): Record<string, ResponseObject> {
  return {
    "400": v1BadRequest("invalid_body", hint),
    "401": unauthorized,
    "403": insufficientScope(scope),
    "404": notFound,
    "429": rateLimited,
  }
}


const paths: Record<string, ContractPathItem> = {
  "/api/v1/repos/{id}": {
    get: {
      tags: ["读取 API"],
      operationId: "getRepo",
      summary: "仓库档案",
      "x-nav-description": "单个仓库的档案，加上最近一期的日 / 周 / 月统计。",
      description:
        "单个仓库的档案，加上最近一期的日 / 周 / 月统计。最近一期取的是**已经存下来的" +
        "最后一期**，不是昨天：采集任务随时可能停，按日历今天取会返回一串空洞，而空洞" +
        "在图上和「这几天真的没人 star」无法区分（§4.1）。\n\n可见性与列表一致：公开可见，" +
        "或这把 key 自己提交的。",
      parameters: [repoIdParam],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response("档案与最近一期统计", ref("#/components/schemas/RepoDetail")),
        ...readFailures("repos:read"),
      },
    },
  },
  "/api/v1/repos/{id}/stats": {
    get: {
      tags: ["读取 API"],
      operationId: "getRepoStats",
      summary: "仓库区间统计",
      "x-nav-description": "日 / 周 / 月粒度的区间统计，窗口内不补洞。",
      description:
        "日 / 周 / 月三种粒度的区间统计，默认最近 90 天。\n\n两条必须知道的行为（§1.3 / §4.1）：" +
        "\n\n- **不补洞**：窗口内没有采集的那些天直接不出现，不是 0。`null` 的含义是" +
        "「这个周期没有采集」，转成 0 会变成「采集到 0」。" +
        "\n- `end` 是该仓库**最新已存周期**，不 clamp 到今天。",
      parameters: [
        repoIdParam,
        {
          name: "cadence",
          in: "query",
          required: false,
          description: "统计粒度",
          schema: { type: "string", enum: ["daily", "weekly", "monthly"], default: "daily" },
        },
        {
          name: "start",
          in: "query",
          required: false,
          description:
            "区间起点，**`YYYY-MM-DD` 或完整 ISO 8601 时间戳**，按 Asia/Shanghai " +
            "日历解释。给日期时取当日 00:00 (+08:00)。缺省 `end - 90d`",
          schema: { type: "string" },
        },
        {
          name: "end",
          in: "query",
          required: false,
          description: "区间终点，写法同 `start`。缺省该仓库最新已存周期",
          schema: { type: "string" },
        },
        limitParam(500, 1000),
        cursorParam,
      ],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response("区间统计", ref("#/components/schemas/RepoStatsRange")),
        ...readFailures("repos:read"),
      },
    },
  },
  "/api/v1/rankings/weekly": {
    get: {
      tags: ["读取 API"],
      operationId: "getWeeklyRankings",
      summary: "指定周排行",
      "x-nav-description": "按 year / week 取指定周的榜单，缺省最近一个完整周。",
      description:
        "`year` / `week` 都不传时取**最近一个完整周期**，响应里的 `period` 会回显" +
        "它——不回显的话，调用方无从知道自己拿到的到底是哪一期，而「静默地排了另一周」" +
        "正是这条路要避免的（§5.1）。\n\n榜单部分沿用现有的 `Rankings`（`trending` + " +
        "`byRelativeGrowth`），并额外带上 `period` 回显。响应带 `ETag` 与 " +
        "`Cache-Control`，可以放心地条件请求。",
      parameters: [
        yearParam,
        {
          name: "week",
          in: "query",
          required: false,
          description: "ISO 周序号 1–53，给了它 year 才有意义",
          schema: { type: "integer", minimum: 1, maximum: 53 },
        },
        limitParam(100),
      ],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response("该周排行", ref("#/components/schemas/Rankings")),
        ...readFailures("rankings:read"),
      },
    },
  },
  "/api/v1/rankings/monthly": {
    get: {
      tags: ["读取 API"],
      operationId: "getMonthlyRankings",
      summary: "指定月排行",
      "x-nav-description": "同一套逻辑，周期换成月。",
      description:
        "与周榜同一套逻辑，周期换成月。参数与缺省规则见 `/api/v1/rankings/weekly`。",
      parameters: [
        yearParam,
        {
          name: "month",
          in: "query",
          required: false,
          description: "月份 1–12",
          schema: { type: "integer", minimum: 1, maximum: 12 },
        },
        limitParam(100),
      ],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response("该月排行", ref("#/components/schemas/Rankings")),
        ...readFailures("rankings:read"),
      },
    },
  },
  "/api/v1/rankings/periods": {
    get: {
      tags: ["读取 API"],
      operationId: "listRankingPeriods",
      summary: "可用周期目录",
      "x-nav-description": "先看哪些周 / 月有数据，再逐期取排行。",
      description:
        "先列目录、再逐期取排行，就不必猜哪些期存在。两种读法用同一组参数覆盖：" +
        "\n\n- 给了 `year`：返回该年**有数据**的期，升序；" +
        "\n- 不给 `year`：倒序返回最近若干期（默认 120）。\n\n**只列有数据的期**——" +
        "列出一个没有行的周，等于把客户端送去拿一个必然 404 的请求。",
      parameters: [
        {
          ...yearParam,
          description: "四位年份。给了就按该年升序返回；不给则倒序返回最近若干期",
        },
        {
          name: "cadence",
          in: "query",
          required: false,
          description: "周期类型",
          schema: { type: "string", enum: ["weekly", "monthly"], default: "weekly" },
        },
        limitParam(120),
      ],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response("周期目录", ref("#/components/schemas/PeriodCatalog")),
        ...readFailures("rankings:read"),
      },
    },
  },
  "/api/v1/subscriptions": {
    post: {
      tags: ["订阅 API"],
      operationId: "createSubscription",
      summary: "创建订阅",
      "x-nav-description": "让雷达每天把新数据推到你的地址。",
      description:
        "让 VercelAI 雷达每天把新数据推到你的地址上。投递**严格挂在两个排行任务都成功之后**，" +
        "所以收到的数据不会缺尚未闭合的周期。\n\n三件事要先分清：\n\n" +
        "- key 的 `subscriptions:write` 管「能不能创建/管理订阅」；订阅自己的 `scopes` 管" +
        "「推什么」。投递时按订阅的 scope 读库，**不借用调用方 key 的权限**。\n" +
        "- `secret` 只在这次响应里出现一次，之后任何接口都不再返回；派发时用它做 HMAC 签名。\n" +
        "- 过滤器不是白名单语义而是「先命中即短路」，规则见 §6.6。",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: jsonContent(ref("#/components/schemas/SubscriptionRequest")),
      },
      responses: {
        "201": response(
          "订阅已创建。`secret` 只此一次",
          ref("#/components/schemas/SubscriptionCreated")
        ),
        ...subscriptionFailures("请求体不符合 schema（filters 的枚举值、callbackUrl 不是 URL 等）"),
      },
    },
    get: {
      tags: ["订阅 API"],
      operationId: "listSubscriptions",
      summary: "列出订阅",
      "x-nav-description": "只列这把 key 自己的订阅。",
      description:
        "只返回**这把 key 自己**的订阅——归属是租户隔离的全部实现，没有别的过滤条件" +
        "（§6.7）。响应里没有 `secret`，只有 `secretPrefix`。",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response("订阅列表", ref("#/components/schemas/SubscriptionList")),
        ...subscriptionFailures("没有查询参数"),
      },
    },
  },
  "/api/v1/subscriptions/{id}": {
    get: {
      tags: ["订阅 API"],
      operationId: "getSubscription",
      summary: "订阅详情",
      "x-nav-description": "单个订阅的命中数与最近 20 次投递。",
      description:
        "单个订阅 + 当前命中多少仓库 + 最近 20 条投递记录（`eventId` / `status` / " +
        "`attempt` / `httpStatus` / `error`）。\n\n没有这段的话，订阅方唯一的排障手段" +
        "就是「等明天看数据有没有更新」（§6.8）。\n\n`matchedRepos` 为 0 时，水位线" +
        "既不推进也不回退：把水位线退到一个空集合的起点，等于让下一次投递重推全表" +
        "（§6.4）。",
      parameters: [subscriptionIdParam],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response("订阅详情", ref("#/components/schemas/SubscriptionDetail")),
        ...subscriptionFailures("路径里的 id 不是合法订阅 id"),
      },
    },
    patch: {
      tags: ["订阅 API"],
      operationId: "updateSubscription",
      summary: "改订阅",
      "x-nav-description": "改过滤器 / scopes，或暂停恢复。",
      description:
        "改过滤器 / scopes、暂停或恢复。\n\n**改动过滤器时水位线会回退**：服务端在同一个" +
        "事务里把 `filtersVersion` 加一，并把水位线退到「新命中集合的最早已存周期」，让" +
        "新纳入的仓库至少被完整推一次——否则它们的历史早于水位线，就永远收不到。" +
        "代价是已推过的数据可能重复一次，消费方靠 payload 里的 `filtersVersion` 区分" +
        "「新数据」与「补发」（§6.4）。",
      parameters: [subscriptionIdParam],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: jsonContent(ref("#/components/schemas/SubscriptionUpdate")),
      },
      responses: {
        "200": response("改后的订阅", ref("#/components/schemas/Subscription")),
        ...subscriptionFailures("请求体不符合 schema"),
      },
    },
    delete: {
      tags: ["订阅 API"],
      operationId: "deleteSubscription",
      summary: "删除订阅",
      "x-nav-description": "删订阅，并清空待投递队列。",
      description:
        "删除订阅，并清空它待投递的队列。已经投递出去的数据不会回收。",
      parameters: [subscriptionIdParam],
      security: [{ bearerAuth: [] }],
      responses: {
        "204": { description: "已删除" },
        ...subscriptionFailures("路径里的 id 不是合法订阅 id"),
      },
    },
  },
  "/api/v1/subscriptions/{id}/rotate-secret": {
    post: {
      tags: ["订阅 API"],
      operationId: "rotateSubscriptionSecret",
      summary: "轮换回调 secret",
      "x-nav-description": "换一把新 secret，旧的立刻失效。",
      description:
        "生成新 secret 并**立刻**让旧的失效，没有「两个都有效」的窗口。新 secret " +
        "同样只返回一次。\n\n轮换之后接收端必须同步更新，否则下一次投递会全部验签失败" +
        "（退避 `1s → 5s → 30s → 5min → 30min`，最多 8 次，之后标记 failed，" +
        "但水位线不动，下一轮 cron 会重新生成一批）。",
      parameters: [subscriptionIdParam],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response("新 secret，仅此一次", ref("#/components/schemas/SubscriptionRotated")),
        ...subscriptionFailures("路径里的 id 不是合法订阅 id"),
      },
    },
  },
  "/api/v1/subscriptions/{id}/test": {
    post: {
      tags: ["订阅 API"],
      operationId: "testSubscription",
      summary: "发一条探测 payload",
      "x-nav-description": "立刻发一条探测事件，验证回调与签名。",
      description:
        "立刻发一条 `subscription.test` 事件（内容极小，含一份真实的当前快照），" +
        "用来验证回调地址可达、签名能过。\n\n**它不推进水位线**——补数据要等正常投递。" +
        "鉴权与签名路径和正常投递完全一致，所以测试能验签通过，正常事件也能。",
      parameters: [subscriptionIdParam],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response("投递结果", ref("#/components/schemas/SubscriptionTest")),
        ...subscriptionFailures("路径里的 id 不是合法订阅 id"),
      },
    },
  },
  "/api/v1/openapi.json": {
    get: {
      tags: ["读取 API"],
      operationId: "getOpenapiDocument",
      summary: "接口自描述",
      "x-nav-description": "需要凭据的 OpenAPI 3.1 契约副本。",
      description:
        "这份契约本身，**需要有效凭据**——加门是为了不把它当成免费的接口发现服务。" +
        "返回的 spec 不含任何实例专属信息。\n\n同一个部署另外提供一个免鉴权的副本 " +
        "`GET /openapi.json`（站内文档与 `llms.txt` 指向它）。两者内容同源，都由 " +
        "`lib/openapi/document.ts` 聚合而成。",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "OpenAPI 3.1 文档",
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "OpenAPI 3.1 文档对象，结构见 https://spec.openapis.org/oas/v3.1.0",
              },
            },
          },
        },
        "401": unauthorized,
        "403": insufficientScope("任意有效凭据"),
        "404": notFound,
        "429": rateLimited,
      },
    },
  },
  "/api/v1/repos": {
    get: {
      tags: ["读取 API"],
      operationId: "listRepos",
      summary: "列出仓库",
      "x-nav-description": "列出这把 key 看得见的仓库及其命中原因。",
      description:
        "列出这把 key 可见的仓库，过滤器与订阅（§6.6）是**同一套语义**：判定按固定" +
        "顺序短路求值，`repoIds` 非空时完全绕过其余规则。响应带上分类四轴，调用方可以" +
        "自己验一遍「为什么这个仓库命中了」。\n\n可见范围是「公开可见 + 这把 key 自己" +
        "提交的」，不含任何用户的私有列表。\n\n分页是 **keyset**（§3.7）：`cursor` 是上一页 " +
        "响应里的 `nextCursor`，**坏的游标返回 400 而不是退回第一页**——静默退回会让调用方 " +
        "以为数据只有一页。`total` 是命中过滤器的总数，与 `limit` 无关。",
      parameters: [
        listParam("repoIds", "显式白名单，逗号分隔。给了就完全覆盖其余过滤器", [
          "V1StGXR8Z5jd",
        ]),
        listParam("projectTypes", "项目形态（`projects.type`）", projectTypeValues),
        listParam("categoryCodes", "运营分类（`categories.code`），与形态正交", [
          "mcp-server",
        ]),
        flagParam(
          "includePlatformProjects",
          "是否纳入有未隐藏 project 行的仓库"
        ),
        listParam("platformTypes", "平台项目的形态", projectTypeValues),
        flagParam(
          "includeUncurated",
          "是否纳入还没有 project 行的候选仓库。" +
            "**缺省按条件推导**：projectTypes / categoryCodes / platformTypes 全空时为 true，" +
            "按类型过滤时为 false——所以「按形态订阅」默认拿不到未策展的仓库，" +
            "想要更宽的范围要显式写 true（设计文档 §6.6 陷阱一）"
        ),
        flagParam("includeOwnSubmissions", "是否纳入这把 key 自己提交过的仓库", true),
        limitParam(50, 500),
        cursorParam,
      ],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": response(
          "命中的一页。`nextCursor` 为 `null` 表示这是最后一页，`total` 是命中总数",
          ref("#/components/schemas/RepoList")
        ),
        ...readFailures("repos:read"),
      },
    },
    post: {
      tags: ["写入 API"],
      operationId: "registerRepo",
      summary: "登记仓库",
      "x-nav-description": "让雷达开始跟踪一个仓库，不发布。",
      description:
        "让雷达开始跟踪一个仓库，**不发布**。请求体只有两种形态，都是「给我一个地址」：" +
        "`{ url }`（一整个 GitHub 地址）或 `{ repo }`（裸 `owner/repo`），两者都可选地带 " +
        "`callbackUrl` + `callbackSecret`。**不接受调用方带来的 GitHub 数据**：那份星标数、" +
        "语言、topics 是调用方某一时刻的快照，落库等于让统计建立在一个可能过期的副本上，" +
        "服务端自己去取。按仓库去重：重发同一地址是安全的，返回 `created: false`。" +
        "带 `type` 的请求会被 400 拒绝并指向 `POST /api/v1/projects`。最长 60 秒（要去 " +
        "GitHub 抓数据）。\n\n给了 `Idempotency-Key` 就启用幂等（§3.3），成功的响应会被" +
        "记住并逐次回放；不带也不产生重复行。",
      security: [{ bearerAuth: [] }],
      parameters: [idempotencyKeyParam],
      requestBody: {
        required: true,
        description:
        "两种形态二选一，都是严格校验，多一个字段整条拒绝：`{ url }` 或 " +
        "`{ repo: \"owner/repo\" }`。回调参数在两种形态下都可用——给了 `callbackUrl` " +
        "就必须给 `callbackSecret`，两者成对出现。",
        content: jsonContent(ref("#/components/schemas/RepoRegisterRequest")),
      },
      responses: {
        "200": response(
          "这个仓库本来就在跟踪里，本次只是刷新",
          ref("#/components/schemas/RepoRegistered")
        ),
        "201": response(
          "新登记，或幂等回放了上次同一个 key 的成功响应（回放保留首次的状态码，所以也是 201）",
          ref("#/components/schemas/RepoRegistered")
        ),
        "400": v1BadRequest(
          "invalid_body / invalid_url / type_not_accepted",
          "不是合法 JSON、字段不符合 schema、不是 GitHub 仓库地址，或带了 `type`"
        ),
        "409": idempotencyConflict(
          "idempotency_key_reuse / idempotency_in_flight",
          "同一个 Idempotency-Key 配了不同的请求体（换仓库请换 key），或同一个 key 的" +
            "请求正在处理中（按 `Retry-After` 稍后重试即可拿到回放）"
        ),
        "401": unauthorized,
        "403": insufficientScope("repos:write"),
        "404": notFound,
        "429": rateLimited,
        "503": githubUnavailable,
      },
    },
  },
  "/api/v1/projects": {
    post: {
      tags: ["写入 API"],
      operationId: "publishProject",
      summary: "发布项目",
      "x-nav-description": "把仓库策展成 project，放到公开站上。",
      description:
        "把一个仓库策展成 project，也就是放到公开站上。地址同样有两种写法：`{ url }` 或 " +
        "`{ repo: \"owner/repo\" }`，加可选的 `type`（缺省 `application`）与回调参数。" +
        "`projects:write` 不在自助签发范围内，需要管理员逐把 key 开。按仓库去重，返回 " +
        "`status: \"existing\"`。最长 300 秒（要拉 README、翻译技能文档并投递）。",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        description:
          "`url` 与 `repo` 二选一；`type` 缺省 `application`；回调参数与登记端点相同",
        content: jsonContent(ref("#/components/schemas/ProjectRequest")),
      },
      responses: {
        "200": response(
          "这个仓库早就发布过（幂等命中）",
          ref("#/components/schemas/ProjectCreated")
        ),
        "201": response(
          "新建了一个项目",
          ref("#/components/schemas/ProjectCreated")
        ),
        "400": v1BadRequest(
          "invalid_body / invalid_url",
          "不是合法 JSON、地址缺失、两种形态都没给，或只给了 `callbackUrl` 没给 `callbackSecret`"
        ),
        "401": unauthorized,
        "403": insufficientScope("projects:write"),
        "404": notFound,
        "429": rateLimited,
        "502": response(
          "创建 project 失败（create_failed），可以重试",
          errorBody
        ),
        "503": githubUnavailable,
      },
    },
  },

  /**
   * 唯一 `security: []` 的端点 —— 所以它必须自己写清"为什么不需要凭据"，否则 spec 的
   * 读者会以为这里漏了。安全边界是配对码本身 + 单 IP 限流（§2.11）。
   */
  "/api/v1/connections/redeem": {
    post: {
      tags: ["配对 API"],
      operationId: "redeemPairingCode",
      summary: "配对码换 API key",
      "x-nav-description": "用一次性配对码换一把 user 档的 API key。**无需凭据。**",
      description:
        "把 `/console/connections` 生成的 8 位配对码换成一把 `user` 档 API key。" +
        "\n\n**这是唯一一个不需要凭据的 `/api/v1` 端点**——它要发的东西就是凭据，所以" +
        "安全边界完全等于 OAuth device flow：8 位无歧义字符、5 分钟 TTL、单次有效、" +
        "`returnUrl` 必须**精确相等**（不是前缀相等），单 IP 每小时 20 次且 fail-closed。" +
        "\n\n**关于码本身的失败一律 404，四种原因同一个答案**（不存在 / 已用过 / 已过期 / " +
        "`returnUrl` 不匹配）。分开报等于给探测者一个二分枚举的 oracle，而攻出一个还没" +
        "被用的码就等于拿到了一把 API key。\n\n另有两个不泄漏任何关于那个码的信息的" +
        "结果：`429 rate_limited`（纯**本地**的 IP 计数）与 `403 quota_exceeded`（码已通过" +
        "全部校验后才可能出现——它只说明**码主人**的 key 存量已到上限，主人得先去 " +
        "`/console/api-keys` 撤销一把）。所以这两条和 404 分得开，而且客户端确实需要" +
        "据此退避或转告主人。\n\n响应恒为 " +
        "`Cache-Control: no-store`；明文 key 只在这里出现一次，之后取不回来。",
      security: [],
      requestBody: {
        required: true,
        description:
          "`returnUrl` 必须与建码时给 console 的那个**完全相等**。前缀匹配会让 " +
          "`https://evil.com/?x=https://a.b` 通过，是典型的开放重定向。",
        content: jsonContent(ref("#/components/schemas/PairingRedeemRequest")),
      },
      responses: {
        "200": response(
          "换到了 key。**`key.secret` 只出现这一次**，丢了只能在 console 里轮换",
          ref("#/components/schemas/PairingRedeemResponse")
        ),
        "400": v1BadRequest(
          "invalid_body",
          "不是合法 JSON，或缺 `code` / `returnUrl`（`returnUrl` 必须是绝对地址）"
        ),
        "403": response(
          "码本身是有效的，但**码主人**的 key 存量已到上限（quota_exceeded）。码没有被" +
          "消费——主人撤销一把 key 后可以用同一个码再试",
          errorBody
        ),
        "404": notFound,
        "429": rateLimited,
      },
    },
  },
}

/** 文档本身。每条 operation 都逐个标注所需 scope。 */
export function buildOpenAPIDocument(): ContractDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: `${SITE_NAME} API`,
      version: "1",
      description:
        "VercelAI 雷达的开放 API：读排行与仓库统计、登记仓库与发布项目、以及把新数据推到" +
        "订阅者地址上。\n\n" +
        "**除 `POST /api/v1/connections/redeem` 之外，每个端点都要 " +
        "`Authorization: Bearer <key>`，没有别的免鉴权旁路。** 各自需要的 `scope` 写在" +
        "每个端点的说明里；配额按 key 计（`user` 档 30 rpm / 1000 rpd，`service` 档 " +
        "60 rpm / 5000 rpd）。\n\n" +
        "接入说明、错误码表与 key 签发见站内 `/docs`；每个端点的交互式文档在 `/docs/api/`。",
    },
    servers: [{ url: SITE_ORIGIN }],
    tags: [
      {
        name: "读取 API",
        description:
        "`repos:read` / `rankings:read`：仓库档案、区间统计与指定周期的排行。",
      },
      {
        name: "写入 API",
        description:
        "`repos:write` / `projects:write`：登记仓库、发布项目。写入 ≠ 对外可见。",
      },
      {
        name: "订阅 API",
        description:
        "`subscriptions:write`：创建、改过滤器、暂停、轮换 secret、发探测事件。",
      },
      {
        name: "配对 API",
        description:
        "**唯一不需要凭据的一组**：用 `/console/connections` 生成的配对码换一把 user 档 " +
        "key（§2.11）。",
      },
    ],
    paths,
    components: {
      securitySchemes: { bearerAuth },
      headers: {
        "Ratelimit-Limit": {
          description: "当前窗口的上限（分钟窗口与日窗口里更紧的那个）",
          schema: { type: "integer" },
        },
        "Ratelimit-Remaining": {
          description: "当前窗口剩余次数",
          schema: { type: "integer" },
        },
        "Ratelimit-Reset": {
          description: "配额恢复那一刻的 epoch 秒（绝对时间，不是倒计时）",
          schema: { type: "integer" },
        },
        "Retry-After": {
          description: "429 时需要等待的秒数；日窗口时可能是几小时",
          schema: { type: "integer" },
        },
      },
      schemas: {
        Error: errorBody,
        RepoUrlRegister: jsonSchema(repoUrlRegisterSchema, "input"),
        RepoSlugRegister: jsonSchema(repoSlugRegisterSchema, "input"),
        RepoRegisterRequest: jsonSchema(repoRegisterRequestSchema, "input"),
        ProjectRequest: jsonSchema(projectRequestSchema, "input"),
        RepoRegistered: jsonSchema(repoRegisteredSchema, "output"),
        ProjectCreated: jsonSchema(projectCreatedSchema, "output"),
        RankedAnomaly: jsonSchema(rankedAnomalySchema, "output"),
        RankedProject: jsonSchema(rankedProjectSchema, "output"),
        Rankings: jsonSchema(rankingsSchema, "output"),
        Classification: jsonSchema(classificationSchema, "output"),
        RepoListItem: jsonSchema(repoListItemSchema, "output"),
        RepoList: jsonSchema(repoListSchema, "output"),
        RepoDetail: jsonSchema(repoDetailSchema, "output"),
        PairingRedeemRequest: jsonSchema(pairingRedeemRequestSchema, "output"),
        PairingRedeemResponse: jsonSchema(pairingRedeemResponseSchema, "output"),
        StatsPeriod: jsonSchema(statsPeriodSchema, "output"),
        RepoStatsRange: jsonSchema(repoStatsRangeSchema, "output"),
        PeriodCatalog: jsonSchema(periodCatalogSchema, "output"),
        SubscriptionFilters: jsonSchema(subscriptionFiltersSchema, "input"),
        SubscriptionRequest: jsonSchema(subscriptionRequestSchema, "input"),
        Subscription: jsonSchema(subscriptionSchema, "output"),
        SubscriptionCreated: jsonSchema(subscriptionCreatedSchema, "output"),
        SubscriptionList: jsonSchema(subscriptionListSchema, "output"),
        DeliveryRecord: jsonSchema(deliveryRecordSchema, "output"),
        SubscriptionDetail: jsonSchema(subscriptionDetailSchema, "output"),
        SubscriptionUpdate: jsonSchema(subscriptionUpdateSchema, "input"),
        SubscriptionRotated: jsonSchema(subscriptionRotatedSchema, "output"),
        SubscriptionTest: jsonSchema(subscriptionTestSchema, "output"),
      },
    },
  }
}

/**
 * 同一份文档，交给 fumadocs-openapi。
 *
 * 它的 `Document` 类型把 `openapi` 钉在 3.2.0 上，而这份文档声明 3.1.0——
 * 内容上 3.2 是 3.1 的超集，渲染器也照单全收，所以这里只需要一次收窄。
 */
export function fumadocsDocument(): Document {
  return buildOpenAPIDocument() as unknown as Document
}

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const

export type OperationRef = { method: string; path: string }

let operationRefs: Map<string, OperationRef> | undefined

export interface OperationSummary extends OperationRef {
  tag: string
  summary: string
  /** 每条 operation 要的 scope，从说明文字里没有就留空。 */
  scope: string
}

const SCOPES: Record<string, string> = {
  getRepo: "repos:read",
  listRepos: "repos:read",
  getRepoStats: "repos:read",
  getWeeklyRankings: "rankings:read",
  getMonthlyRankings: "rankings:read",
  listRankingPeriods: "rankings:read",
  registerRepo: "repos:write",
  publishProject: "projects:write",
  createSubscription: "subscriptions:write",
  listSubscriptions: "subscriptions:write",
  getSubscription: "subscriptions:write",
  updateSubscription: "subscriptions:write",
  deleteSubscription: "subscriptions:write",
  rotateSubscriptionSecret: "subscriptions:write",
  testSubscription: "subscriptions:write",
}

/**
 * 每条 operation 的一行摘要，按 tag 分组前的原样顺序。
 *
 * `llms.txt` 与 `llms-full.txt` 要列出端点，但它们不是要重述契约——那是这份文档的
 * 职责，而重述一遍只会让两份文本各自漂移。所以这两个文件从这里取「方法 + 路径 +
 * 标题」，scope 也在这里查而不是从说明文字里抠：说明会改，路由不会。
 */
export function listOperations(): OperationSummary[] {
  const { paths } = buildOpenAPIDocument()
  const out: OperationSummary[] = []
  for (const [path, item] of Object.entries(paths ?? {})) {
    if (!item) continue
    for (const method of HTTP_METHODS) {
      const operation = item[method]
      const id = operation?.operationId
      if (!operation || !id) continue
      out.push({
        method: method.toUpperCase(),
        path,
        tag: operation.tags?.[0] ?? "",
        summary: operation.summary ?? id,
        scope: SCOPES[id] ?? "",
      })
    }
  }
  return out
}

/**
 * operationId → 方法与路径。
 *
 * 文档侧栏要显示「GET /api/v1/rankings/weekly」这样的端点本身，而 operationId
 * 是生成出来的文件名（`getWeekRanking.mdx`），两边只能在这里对上。只算一次：
 * 文档每次调用都会重建，而侧栏每渲染一页都要查。
 */
export function operationRef(operationId: string): OperationRef | undefined {
  if (operationRefs === undefined) {
    const refs = new Map<string, OperationRef>()
    const { paths } = buildOpenAPIDocument()
    for (const [path, item] of Object.entries(paths ?? {})) {
      if (!item) continue
      for (const method of HTTP_METHODS) {
        const id = item[method]?.operationId
        if (id) refs.set(id, { method: method.toUpperCase(), path })
      }
    }
    operationRefs = refs
  }
  return operationRefs.get(operationId)
}

/**
 * operationId → `x-nav-description`，也就是导航用的一句话概要。
 *
 * 谁在用：只有 `scripts/generate-openapi-docs.ts`，把它写进逐端点页面的
 * frontmatter `description`（页脚的上一页 / 下一页、`<meta description>` 都读
 * 那个字段）。散文走 operation 自己的 `description`，见 `ContractOperation`
 * 上面那段为什么两者要分开。
 *
 * 缺一个就抛错，而不是给个空串：漏写的那一页，页脚会退化成「下一页」三个字，
 * 看上去像没写文案，而真正的原因是这条 operation 少了一个键。
 */
export function navDescriptions(): Map<string, string> {
  const out = new Map<string, string>()
  const { paths } = buildOpenAPIDocument()

  for (const [path, item] of Object.entries(paths ?? {})) {
    if (!item) continue
    for (const method of HTTP_METHODS) {
      const operation = item[method]
      if (!operation) continue

      const id = operation.operationId
      const nav = operation["x-nav-description"]
      if (!id || !nav) {
        throw new Error(`${method.toUpperCase()} ${path} 缺少 x-nav-description`)
      }

      out.set(id, nav)
    }
  }

  return out
}
