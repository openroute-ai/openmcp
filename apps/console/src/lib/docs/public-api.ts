/**
 * The four anonymous JSON endpoints, described once.
 *
 * This is the documentation of the public API as an actual data structure rather
 * than as prose inside a page component, and the reason is that the page and
 * `/llms-full.txt` are both generated from it. A page written as JSX can only be
 * checked by reading it; a table that an agent is also served from can be checked
 * against the handler once, and a field that disappears from the response stops
 * being documented the next time the endpoint list is rendered rather than the
 * next time somebody remembers.
 *
 * Every entry here is transcribed from the handler it describes, not from the
 * page it replaced. Where a handler and its older documentation disagreed, the
 * handler won and the difference is called out in the note.
 */

import { ANOMALY_KINDS, ANOMALY_SEVERITIES } from "@/db/schema/github"

/** One query parameter: its name, its type, and what it does. */
export interface ParamDoc {
  name: string
  type: string
  detail: string
}

/** One response field: where it sits, what it is, what it means. */
export interface FieldDoc {
  path: string
  type: string
  detail: string
}

/** One non-2xx outcome, so a caller can branch on the code rather than the prose. */
export interface ErrorDoc {
  status: number
  when: string
}

export interface EndpointDoc {
  path: string
  title: string
  summary: string
  params: ParamDoc[]
  fields: FieldDoc[]
  errors: ErrorDoc[]
  note?: string
  /** A `curl` that returns something, used verbatim on the page and in llms.txt. */
  example?: string
}

/**
 * The weekly ranking.
 *
 * `trending` is sorted by absolute gain and `byRelativeGrowth` by the ratio, and
 * both are capped at 100 rows by the service's own default. There is no `limit`
 * parameter: the cap is a property of the computation, not of the request, and a
 * parameter that could only raise it would let a caller hold a response open.
 */
const WEEK: EndpointDoc = {
  path: "/api/rankings/week.json",
  title: "周榜",
  summary:
    "ISO 周内星标绝对增量前 100，同时给出相对增速排序。缺省为最近一个完整周，可指定任意周。",
  params: [
    {
      name: "year",
      type: "number",
      detail: "ISO 周的年份，四位数字。缺省为本周所在年。",
    },
    {
      name: "week",
      type: "number",
      detail: "ISO 周序号，1–53。缺省为最近一个完整周。",
    },
  ],
  fields: [
    { path: "period", type: '"week"', detail: "周期类型，固定为 `week`。" },
    { path: "year", type: "number", detail: "返回的 ISO 周年份。" },
    { path: "week", type: "number", detail: "返回的 ISO 周序号，与请求一致。" },
    {
      path: "trending[]",
      type: "RankedProject[]",
      detail: "按 `delta` 降序，最多 100 条。见下方字段表。",
    },
    {
      path: "byRelativeGrowth[]",
      type: "RankedProject[]",
      detail:
        "同一批项目，按 `relativeGrowth` 降序。同一条记录会出现在两个数组里，结构完全一致。",
    },
  ],
  errors: [
    { status: 400, when: "`week` 不是 1–53 的整数，或 `year` 不是四位数字。" },
    { status: 404, when: "该周没有记录。两个数组都是空的，不是空榜单。" },
  ],
  note: "响应头 `Cache-Control: public, max-age=0, s-maxage=3600`——CDN 缓存一小时，客户端不缓存。",
}

/** The monthly ranking. Identical shape, different period. */
const MONTH: EndpointDoc = {
  path: "/api/rankings/month.json",
  title: "月榜",
  summary: "字段与周榜完全一致，周期换成自然月。缺省为最近一个完整月。",
  params: [
    {
      name: "year",
      type: "number",
      detail: "年份，四位数字。缺省为本月所在年。",
    },
    {
      name: "month",
      type: "number",
      detail: "月份，1–12。缺省为最近一个完整月。",
    },
  ],
  fields: [
    { path: "period", type: '"month"', detail: "周期类型，固定为 `month`。" },
    { path: "year", type: "number", detail: "返回的年份。" },
    { path: "month", type: "number", detail: "返回的月份，与请求一致。" },
    {
      path: "trending[]",
      type: "RankedProject[]",
      detail: "字段名与含义都与周榜的 `trending[]` 相同。",
    },
    {
      path: "byRelativeGrowth[]",
      type: "RankedProject[]",
      detail: "同周榜。",
    },
  ],
  errors: [
    { status: 400, when: "`month` 不是 1–12 的整数，或 `year` 不是四位数字。" },
    { status: 404, when: "该月没有记录。" },
  ],
}

/**
 * The yearly report.
 *
 * A different shape from the other two, and deliberately so: this artefact is
 * kept faithful to the shape the source app published, because a report that is
 * cited in an article is cited by field name. `slug` is here for the same reason
 * `full_name` is snake_case while the rankings are camelCase.
 */
const RISING_STARS: EndpointDoc = {
  path: "/api/rankings/rising-stars.json",
  title: "年度飙升榜",
  summary:
    "某一自然年内星标绝对增量最大的项目。适合做年度回顾；判断「谁正在被新发现」请看周榜的 `relativeGrowth`。",
  params: [
    {
      name: "year",
      type: "number",
      detail: "四位数字。缺省为上一个完整自然年（北京时间时区口径）。",
    },
  ],
  fields: [
    { path: "date", type: "string", detail: "报告生成时间，ISO 8601。" },
    {
      path: "count",
      type: "number",
      detail: "入选项目数，与 `projects.length` 相同。",
    },
    {
      path: "projects[].full_name",
      type: "string",
      detail: "`owner/name`，报告的自然键。",
    },
    {
      path: "projects[].slug",
      type: "string",
      detail: "站内项目页的 slug，拼接 `/projects/[slug]` 用。",
    },
    {
      path: "projects[].stars",
      type: "number",
      detail: "年末时点的累计星标。",
    },
    {
      path: "projects[].delta",
      type: "number",
      detail: "全年获得的星标数，可为负。",
    },
    {
      path: "projects[].monthly",
      type: "(number | null)[]",
      detail:
        "每月增量，12 月在前，所以下标 0 是 12 月。没有记录的月份是 `null`，不是 0。",
    },
    {
      path: "projects[].tags",
      type: "string[]",
      detail: "从仓库 topics 归一化来的分类 code。",
    },
    {
      path: "projects[].created_at",
      type: "string",
      detail: "仓库创建时间，ISO 8601 字符串。",
    },
    {
      path: "tags[]",
      type: "{ name: string, code: string }[]",
      detail: "入选项目携带的全部标签，名称与 code。",
    },
  ],
  errors: [
    { status: 400, when: "`year` 不是四位数字。" },
    { status: 404, when: "这一年没有入选项目。" },
  ],
  note: "字段命名沿用发布产物的形状（`full_name` / `created_at` 为 snake_case），与两个周期榜的 camelCase 不同。这是刻意的：被文章引用的报告会按字段名被引用。",
}

/** The anomaly feed. */
const ANOMALIES: EndpointDoc = {
  path: "/api/anomalies.json",
  title: "异动流",
  summary:
    "命中判定规则的仓库，按检测时间倒序。只报忧；健康加速项需要显式请求 `include=good`。",
  params: [
    {
      name: "limit",
      type: "number",
      detail: "返回条数，默认与上限都是 100。要更多请走数据库。",
    },
    {
      name: "kind",
      type: `enum: ${ANOMALY_KINDS.join(" | ")}`,
      detail:
        "按命中规则过滤。取值必须命中枚举——非法值返回 400，而不是被当成「除这些以外」。",
    },
    {
      name: "since",
      type: "string",
      detail: "ISO 8601 时间戳，只返回该时刻之后检测到的异动。缺省为不限。",
    },
    {
      name: "include",
      type: '"good"',
      detail:
        "取 `good` 时把健康加速项也一并返回。缺省只返回告警项——一个问「有哪些异动」的人想听的是出问题的那部分。",
    },
  ],
  fields: [
    { path: "anomalies[].repo", type: "string", detail: "`owner/name`。" },
    {
      path: "anomalies[].kind",
      type: `enum: ${ANOMALY_KINDS.join(" | ")}`,
      detail: "测到了什么。",
    },
    {
      path: "anomalies[].severity",
      type: `enum: ${ANOMALY_SEVERITIES.join(" | ")}`,
      detail: "有多要紧。`good` 只给 `star_acceleration` 用。",
    },
    {
      path: "anomalies[].title",
      type: "string",
      detail: "一句人读得懂的说明。",
    },
    {
      path: "anomalies[].magnitude",
      type: "number",
      detail:
        "排序用的量级，含义随规则而变：断崖是丢失的星数，停滞是天数，许可证变更是 0。",
    },
    {
      path: "anomalies[].period",
      type: "string",
      detail: "判定所依据的周期，ISO 8601。",
    },
    {
      path: "anomalies[].detectedAt",
      type: "string",
      detail: "检测时间，ISO 8601。排序键。",
    },
    {
      path: "anomalies[].metric",
      type: "object",
      detail: "触发时的完整读数：基数、最新值、阈值。",
    },
    {
      path: "anomalies[].evidence.series",
      type: "array",
      detail: "判定用到的原始序列，`label` / `value` 对。",
    },
    {
      path: "anomalies[].evidence.notes",
      type: "string[]",
      detail: "两三句说明这次为什么算命中。",
    },
    { path: "count", type: "number", detail: "本次返回的条数。" },
    {
      path: "generatedAt",
      type: "string",
      detail: "本次响应的生成时间，ISO 8601。",
    },
  ],
  errors: [
    {
      status: 400,
      when: "`kind` 不在枚举里，或 `since` 不是可解析的 ISO 8601。",
    },
  ],
  note: "每条异动都带 `metric` 与 `evidence`：调用方不必回查判定代码就能复核这次为什么被判为命中。被人工判为误报的记录留在库里，但不再出现在这个流里。",
}

/** The fields of a row in either rankings array, transcribed from `RankedProject`. */
export const RANKED_PROJECT_FIELDS: FieldDoc[] = [
  {
    path: "fullName",
    type: "string",
    detail:
      "`owner/name`，榜单的自然键，也是 `byRelativeGrowth` 里的同一个键。",
  },
  { path: "name", type: "string", detail: "仓库名，不含 owner。" },
  { path: "description", type: "string", detail: "项目描述。" },
  { path: "stars", type: "number", detail: "周期结束时点的累计星标。" },
  {
    path: "delta",
    type: "number",
    detail: "该周期获得的星标数，可为负。榜单默认按它降序。",
  },
  {
    path: "relativeGrowth",
    type: "number | null",
    detail: "增量除以期初星标。期初为 0 时是 `null`，不是 `Infinity`。",
  },
  {
    path: "tags",
    type: "string[]",
    detail: "从仓库 topics 归一化来的分类 code。",
  },
  {
    path: "ownerId",
    type: "number",
    detail: "GitHub owner 的数字 id，可用于头像 URL。",
  },
  { path: "createdAt", type: "string", detail: "仓库创建时间，ISO 8601。" },
  {
    path: "logo / iconUrl / avatar",
    type: "string | null",
    detail:
      "渲染列表需要的标记，按这个优先级取。三个都是 `null` 是正常的，回退到项目首字母。",
  },
  {
    path: "anomaly",
    type: "object | null",
    detail:
      "该仓库当期最严重的一条未处理异动，带 `kind` / `severity` / `title`。没有则为 `null`。",
  },
]

export const PUBLIC_API_ENDPOINTS: EndpointDoc[] = [
  WEEK,
  MONTH,
  RISING_STARS,
  ANOMALIES,
]

/** The four paths, for the sitemap and for `llms.txt`'s section on the API. */
export const PUBLIC_API_PATHS = PUBLIC_API_ENDPOINTS.map(
  (endpoint) => endpoint.path
)
