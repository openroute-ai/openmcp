/**
 * The reads the agent card advertises.
 *
 * Each skill answers with two things rather than one: `data`, the JSON an agent
 * can compute with, and `text`, the same numbers written out so a model that
 * never parses the JSON still gets a usable answer. A2A artifacts carry both,
 * and a caller picks whichever it can read.
 *
 * The skills are thin over the services the pages already render from. That is
 * the whole design and it is load-bearing: an agent card is a *claim* about what
 * this site can do, and a skill implemented separately from the page would make
 * that claim drift the first time a threshold changed. So `explain` is built
 * from `FAQS` and `ruleCards()` — the same modules `/llms-full.txt` and
 * `/method` render — and the boards come from `buildRankingsFor*`. There is no
 * second copy of a threshold or a field name in this file.
 *
 * Every read here is anonymous by design (see the agent card's `security`). That
 * is a product decision, not an oversight: the numbers are already public HTML,
 * and requiring a key to read them in JSON would only stop agents from reading
 * what any browser can. It is bounded per address by
 * `consumeAnonymousRateLimit`.
 */
import { db } from "@/db/client"
import {
  buildRankingsForDay,
  buildRankingsForMonth,
  buildRankingsForWeek,
  latestDailyPeriod,
  type RankedProject,
} from "@/lib/github/service/rankings"
import { ruleCards } from "@/lib/docs/radar-rules"
import { RANKED_PROJECT_FIELDS } from "@/lib/docs/ranked-fields"
import { FAQS } from "@/lib/faq"
import { getPublicProjectDetail } from "@/lib/public/radar"
import { listOpenAnomalies, listRepoAnomalies } from "@/lib/radar/anomalies"
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_NAME_EN,
  SITE_ORIGIN,
  SITE_TAGLINE,
} from "@/lib/config/site"
import { civilOf } from "@/lib/time"
import {
  lastCompletePeriod,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"

/** A skill's answer: the numbers, and the same numbers in prose. */
export interface SkillAnswer {
  data: unknown
  text: string
}

/**
 * A skill that could not answer, as opposed to one that answered with nothing.
 *
 * The distinction matters for a ranking: an empty `trending` means the period
 * has no data, while a bad `week` parameter means the caller asked a question
 * this site cannot parse. Both are 200-shaped to an agent, so the difference has
 * to be in the payload.
 */
export class SkillInputError extends Error {
  constructor(readonly detail: string) {
    super(detail)
    this.name = "SkillInputError"
  }
}

/* ───────────────────────────── explain ───────────────────────────── */

/**
 * What this site is, and how to read its output.
 *
 * Generated from the FAQ and the rule cards rather than written out, so the
 * colour convention and the five thresholds an agent is told about here are the
 * ones the site renders. An agent card that described a threshold the code no
 * longer uses would be worse than no card.
 */
export function explainSite(): SkillAnswer {
  const rules = ruleCards()
  const data = {
    name: SITE_NAME,
    nameEn: SITE_NAME_EN,
    tagline: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    whatItDoes: [
      "记录每个 stargazer 的到达时间，而不是只读 star 总数",
      "据此按日 / 周 / 月计算星标增量、增速与加速度",
      "用五条规则跑出异动：增速断崖、异常加速、维护停滞、推送停滞、许可证变更",
      "每条结论都可以点开看原始时间轴，判定依据逐项公开",
    ],
    whatItDoesNotDo: [
      "不给任何项目打综合评分——分数主要由 star 数决定，只是把读者已知的维度复述一遍",
      "不用 AI 做判定，规则与阈值都是代码里的常量",
      "不排名「最好的项目」，只回答「谁在加速、谁在衰退」",
    ],
    colorConvention: {
      up: "绿 = 涨 / 加速",
      down: "红 = 跌 / 衰退",
      note: "颜色只表示涨跌方向；风险等级另用图标与标签文字表达，不靠颜色单独承担信息。",
    },
    thresholds: rules.map((rule) => ({
      kind: rule.kind,
      title: rule.title,
      level: rule.level,
      summary: rule.summary,
      conditions: rule.conditions,
      evidence: rule.evidence,
    })),
    rankingFields: RANKED_PROJECT_FIELDS,
    faq: FAQS.map((entry) => ({ q: entry.question, a: entry.answer })),
  }

  const text = [
    `${SITE_NAME}（${SITE_NAME_EN}）——${SITE_TAGLINE}`,
    "",
    data.whatItDoes.map((line) => `- ${line}`).join("\n"),
    "",
    "刻意不做的事：",
    data.whatItDoesNotDo.map((line) => `- ${line}`).join("\n"),
    "",
    `颜色约定：${data.colorConvention.up}，${data.colorConvention.down}。${data.colorConvention.note}`,
    "",
    "五条判定规则：",
    ...rules.flatMap((rule) => [
      `- ${rule.title}（${rule.kind}）：${rule.summary}`,
      ...rule.conditions.map(([left, right]) => `    · ${left} → ${right}`),
    ]),
  ].join("\n")

  return { data, text }
}

/* ───────────────────────────── rankings ───────────────────────────── */

/** Cap on one answer. The boards themselves cap at 100. */
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

/**
 * A day / week / month board.
 *
 * `cadence` defaults to the weekly board because a single day is dominated by
 * whichever project happened to get a link, and an agent asking for "the
 * rankings" without naming a period wants the one a human would look at.
 */
export async function readRankings(input: {
  cadence?: "day" | "week" | "month"
  year?: number
  week?: number
  month?: number
  day?: string
  limit?: number
}): Promise<SkillAnswer> {
  const cadence = input.cadence ?? "week"
  const limit = clampLimit(input.limit)
  const now = new Date()

  if (cadence === "day") {
    const day =
      input.day === undefined ? await latestDay() : resolveDay(input.day, now)
    const board = await buildRankingsForDay(db, day, { limit })
    // The day a period covers and the number of projects written for it travel
    // together: a board that says "2026-10-02" with three rows is a partial
    // write, and a caller cannot tell that from the date alone.
    return answerBoard(board, "日榜", limit)
  }

  if (cadence === "month") {
    const target = resolveYearMonth(input.year, input.month, now)
    const board = await buildRankingsForMonth(db, target, { limit })
    return answerBoard(board, "月榜", limit)
  }

  const target = resolveYearWeek(input.year, input.week, now)
  const board = await buildRankingsForWeek(db, target, { limit })
  return answerBoard(board, "周榜", limit)
}

/**
 * One board, in both shapes.
 *
 * The prose carries the denominator next to the percentage deliberately. A bare
 * `+312%` does not tell a reader whether that is a project going from 40 stars
 * to 165 or from 40,000 to 165,000, and the whole argument for publishing
 * relative growth is that it is readable only next to the absolute numbers.
 */
function answerBoard(
  board: {
    trending: RankedProject[]
    byRelativeGrowth: RankedProject[]
    period: string
    day?: string
    year?: number
    week?: number
    month?: number
    /** Only ever set for a daily board; see {@link narrowDayNote}. */
    projectsMeasured?: number
  },
  label: string,
  limit: number
): SkillAnswer {
  const periodLabel = boardLabel(board)

  const line = (project: RankedProject): string =>
    `${project.fullName} · +${project.delta} 星 · 基数 ${starsBefore(project)} · ` +
    `${project.relativeGrowth === null ? "相对增速 n/a（期初为 0）" : `${(project.relativeGrowth * 100).toFixed(1)}%`}`

  const text = [
    `${label}（${periodLabel}）按星标增量，前 ${board.trending.length} 条：`,
    ...board.trending.map((project, index) => `${index + 1}. ${line(project)}`),
    "",
    `同周期按相对增速排序，前 ${board.byRelativeGrowth.length} 条：`,
    ...board.byRelativeGrowth.map(
      (project, index) => `${index + 1}. ${line(project)}`
    ),
    board.trending.length === 0
      ? "这一期没有数据。可能该周期尚未采集完成，或采集器还没跑到。"
      : narrowDayNote(board),
    `limit=${limit}。榜单字段：${RANKED_PROJECT_FIELDS.map((field) => field.path).join(", ")}。`,
    "注：本榜不含综合评分；relativeGrowth 在期初星标为 0 时为 null，不是无穷大。",
  ]
    .filter((part) => part !== "")
    .join("\n")

  return { data: board, text }
}

/**
 * The default day: the newest day with data, not yesterday.
 *
 * See {@link latestDailyPeriod} for why "yesterday" is almost always empty here.
 */
async function latestDay(): Promise<{
  year: number
  month: number
  day: number
}> {
  const period = await latestDailyPeriod(db)
  if (period) return civilOf(period)
  // A daily table that has never been written still has an answer: ask for the
  // day before today and let the board report the empty list it produces.
  return civilOf(new Date(Date.now() - 86_400_000))
}

/**
 * Flags a daily board that covers fewer projects than a full day would.
 *
 * The daily writer is a sampler, so its newest day is often a partial run. The
 * board is still real data — those projects did gain those stars that day — but
 * "the top 20 of 12 measured projects" is a different claim from "the top 20 of
 * the day", and an agent quoting the first as the second would be wrong.
 */
function narrowDayNote(board: {
  period: string
  projectsMeasured?: number
}): string {
  if (board.period !== "day") return ""
  const measured = board.projectsMeasured ?? 0
  if (measured === 0 || measured >= NARROW_DAY_THRESHOLD) return ""
  return (
    `注意：这一天只采集到 ${measured} 个项目（日榜由采样器写入，最新一天常常是部分写入）。` +
    "上面的名单是该次采集内的排名，不等于当日全量。"
  )
}

/** A day covering fewer projects than this is treated as a partial write. */
const NARROW_DAY_THRESHOLD = 50

function boardLabel(board: {
  period: string
  day?: string
  year?: number
  week?: number
  month?: number
}): string {
  if (board.period === "day") return board.day ?? "（日期未知）"
  if (board.period === "week") return `${board.year} 第 ${board.week} 周`
  return `${board.year}-${String(board.month ?? 0).padStart(2, "0")}`
}

/* ──────────────────────────── rising stars ──────────────────────────── */

/**
 * The rising board: growth rate, behind two absolute floors.
 *
 * The floors are the board's whole editorial claim and they are inherited rather
 * than restated. Ranking purely by percentage puts a project going from 4 stars
 * to 12 at the top of every week, which is arithmetically true and decision-
 * worthless; requiring a base and an absolute gain is what makes a percentage
 * mean something.
 */
const MIN_BASE_STARS = 200
const MIN_DELTA = 50

/** Candidates pulled before the floor is applied. */
const RISING_CANDIDATES = 500

export async function readRisingStars(input: {
  year?: number
  week?: number
  limit?: number
}): Promise<SkillAnswer> {
  const target = resolveYearWeek(input.year, input.week, new Date())
  const limit = clampLimit(input.limit)

  const board = await buildRankingsForWeek(db, target, {
    limit: RISING_CANDIDATES,
  })
  const qualifying = board.byRelativeGrowth.filter(passesFloor)
  const rows = qualifying.slice(0, limit)

  const data = {
    period: board.period,
    year: board.year,
    week: board.week,
    thresholds: { minBaseStars: MIN_BASE_STARS, minDelta: MIN_DELTA },
    candidatesConsidered: board.byRelativeGrowth.length,
    rising: rows,
  }

  const text = [
    `飙升榜（${board.year} 第 ${board.week} 周）：上周星标 ≥ ${MIN_BASE_STARS}、本周新增 ≥ ${MIN_DELTA}。`,
    ...rows.map((project, index) => {
      const growth =
        project.relativeGrowth === null
          ? "n/a"
          : `${(project.relativeGrowth * 100).toFixed(1)}%`
      return (
        `${index + 1}. ${project.fullName} · ${growth} · 本周 +${project.delta} · ` +
        `上周 ${starsBefore(project)}`
      )
    }),
    rows.length === 0 ? "这一周没有项目越过门槛。" : "",
    `门槛前取 ${board.byRelativeGrowth.length} 个候选，门槛后剩 ${qualifying.length} 个，返回前 ${rows.length} 个。`,
  ]
    .filter((part) => part !== "")
    .join("\n")

  return { data, text }
}

function passesFloor(project: RankedProject): boolean {
  return starsBefore(project) >= MIN_BASE_STARS && project.delta >= MIN_DELTA
}

function starsBefore(project: RankedProject): number {
  return Math.max(0, project.stars - project.delta)
}

/* ────────────────────────── project detail ────────────────────────── */

/**
 * One project's public detail.
 *
 * Addressed as `owner/name` rather than by the opaque `projects.id`, because the
 * natural key is what an agent has read out of a ranking row and what a human
 * has read out of a URL. That means the detail read takes the same path a page
 * takes, so an agent and a reader cannot be shown different numbers for the same
 * repository.
 */
export async function readProjectDetail(input: {
  fullName?: string
  owner?: string
  name?: string
}): Promise<SkillAnswer> {
  const owner = input.owner ?? ownerOf(input.fullName)
  const name = input.name ?? nameOf(input.fullName)

  if (!owner || !name) {
    throw new SkillInputError(
      '需要 fullName（如 "facebook/react"），或同时给出 owner 与 name。'
    )
  }

  const project = await getPublicProjectDetail(db, owner, name)
  if (!project) {
    throw new SkillInputError(
      `没有公开的 ${owner}/${name}：可能不存在、未收录，或已被标记为不公开。`
    )
  }

  // `days[].stars` and `weeks[].stars` are what the period *gained*, not a
  // running total, so the 90-day figure is their sum and the series is a bar
  // chart of gains rather than a line of totals. Naming it `starsGained` keeps
  // that distinction visible in the payload instead of leaving a caller to
  // discover it by comparing two entries.
  const measuredDays = project.days.filter((day) => day.stars !== undefined)
  const daysGained = measuredDays.reduce(
    (sum, day) => sum + (day.stars ?? 0),
    0
  )
  const anomalies = await listRepoAnomalies(db, project.repoId, 5)

  const data = {
    fullName: project.fullName,
    name: project.name,
    owner: project.owner,
    description: project.description,
    stars: project.stars,
    starsGainedLast90Days: daysGained,
    measuredDays: measuredDays.length,
    forks: project.forks,
    contributors: project.contributors,
    releases: project.releases,
    latestReleasePublishedAt:
      project.latestReleasePublishedAt?.toISOString() ?? null,
    license: project.license,
    language: project.language,
    pushedAt: project.pushedAt.toISOString(),
    createdAt: project.createdAt.toISOString(),
    tags: project.tags,
    openAnomalies: anomalies.map((row) => ({
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      detectedAt: row.detectedAt.toISOString(),
      evidence: row.evidence,
    })),
    weeklyStarGains: project.weeks.map((week) => ({
      yearWeek: week.yearWeek,
      starsGained: week.stars ?? null,
    })),
    dailyStarGains: project.days.map((day) => ({
      day: day.day,
      starsGained: day.stars ?? null,
    })),
    url: `${SITE_ORIGIN}/projects/${project.owner}/${project.name}`,
  }

  const text = [
    `${project.fullName}${project.description ? `：${project.description}` : ""}`,
    `当前星标 ${project.stars}；近 90 天新增 ${daysGained}（${measuredDays.length} 天有采集记录）。`,
    `Fork ${project.forks}；贡献者 ${project.contributors ?? "未记录"}；发布 ${project.releases}` +
      `${project.latestReleasePublishedAt ? `（最近一次 ${project.latestReleasePublishedAt.toISOString().slice(0, 10)}）` : ""}。`,
    `许可证 ${project.license ?? "未记录"}；主语言 ${project.language ?? "未记录"}。`,
    `最近推送 ${project.pushedAt.toISOString().slice(0, 10)}；建库 ${project.createdAt.toISOString().slice(0, 10)}。`,
    anomalies.length > 0
      ? `当前异动：${anomalies.map((row) => `${row.title}（${row.kind}）`).join("；")}。`
      : "当前没有命中的异动规则。",
    `注意：weeklyStarGains / dailyStarGains 的值是「该周期新增」，不是累计星标。`,
    `页面：${data.url}`,
  ].join("\n")

  return { data, text }
}

/* ───────────────────────────── anomalies ───────────────────────────── */

/** The open anomaly feed, newest first. */
export async function readAnomalies(input: {
  limit?: number
  /** 问「异动」的人想知道哪个项目出了问题，所以正向异动要显式要才有。 */
  includeGood?: boolean
}): Promise<SkillAnswer> {
  const limit = clampLimit(input.limit ?? 20)
  const rows = await listOpenAnomalies(db, {
    limit,
    includeGood: input.includeGood === true,
  })

  const text = [
    `当前异动 ${rows.length} 条：`,
    ...rows.map(
      (row, index) =>
        `${index + 1}. [${row.kind}] ${row.title} · ${row.owner}/${row.name}` +
        `${row.stars === null ? "" : ` · ${row.stars} 星`}`
    ),
    rows.length === 0 ? "现在没有命中任何一条判定规则的项目。" : "",
    input.includeGood
      ? "已按请求包含 `good`（正向异动）。"
      : "默认不列 `good`（正向异动）：问「异动」的人想知道的是哪个项目出了问题。",
    "每条的判定依据（metric 与 evidence）在 evidence 字段与项目详情页里。",
  ]
    .filter((part) => part !== "")
    .join("\n")

  return { data: { anomalies: rows }, text }
}

/* ─────────────────────────── period parsing ─────────────────────────── */

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw)))
}

/**
 * Which period to answer with.
 *
 * No arguments means the most recent *complete* period, never the one in
 * progress. Ranking a half-finished week against finished ones would report a
 * number that will be wrong by tomorrow, and an agent caching today's answer is
 * exactly the case where being quietly wrong is expensive.
 */
function resolveYearWeek(
  year: number | undefined,
  week: number | undefined,
  now: Date
): YearWeek {
  const fallback = lastCompletePeriod("week", now)
  if (year === undefined && week === undefined) return fallback
  if (year === undefined || week === undefined) {
    throw new SkillInputError("year 与 week 必须成对给出，或都不给。")
  }
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new SkillInputError("year 必须是 2000-9999 之间的整数。")
  }
  if (!Number.isInteger(week) || week < 1 || week > 53) {
    throw new SkillInputError("week 必须是 1-53 之间的整数。")
  }
  return { year, week }
}

function resolveYearMonth(
  year: number | undefined,
  month: number | undefined,
  now: Date
): YearMonth {
  const fallback = lastCompletePeriod("month", now)
  if (year === undefined && month === undefined) return fallback
  if (year === undefined || month === undefined) {
    throw new SkillInputError("year 与 month 必须成对给出，或都不给。")
  }
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new SkillInputError("year 必须是 2000-9999 之间的整数。")
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new SkillInputError("month 必须是 1-12 之间的整数。")
  }
  return { year, month }
}

/**
 * `YYYY-MM-DD`, in Asia/Shanghai.
 *
 * The zone is the one every period boundary in this codebase uses, so "yesterday"
 * means the same day here as it does in `repo_daily_stats`' key.
 */
function resolveDay(
  raw: string | undefined,
  now: Date
): {
  year: number
  month: number
  day: number
} {
  if (raw === undefined) {
    const yesterday = new Date(now.getTime() - 86_400_000)
    return civilOf(yesterday)
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) {
    throw new SkillInputError('day 必须是 "YYYY-MM-DD" 形式的日期。')
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new SkillInputError(`"${raw}" 不是一个存在的日期。`)
  }
  return { year, month, day }
}

/** `owner/name` → `owner`. Anything malformed yields `undefined`, not a guess. */
function ownerOf(fullName: string | undefined): string | undefined {
  const parts = splitFullName(fullName)
  return parts?.[0]
}

function nameOf(fullName: string | undefined): string | undefined {
  return splitFullName(fullName)?.[1]
}

function splitFullName(
  fullName: string | undefined
): [string, string] | undefined {
  if (!fullName) return undefined
  const parts = fullName.split("/")
  if (parts.length !== 2) return undefined
  const [owner, name] = parts
  if (!owner || !name) return undefined
  return [owner, name]
}
