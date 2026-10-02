import type { Metadata } from "next"

import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import {
  PublicProjectBoard,
  type PublicProjectGroup,
  type PublicProjectItem,
} from "@/components/public/public-project-list"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import {
  buildRankingsForWeek,
  type RankedProject,
} from "@/lib/github/service/rankings"
import { previousIsoWeek, type YearWeek } from "@/lib/github/snapshot-dates"
import { resolveWeek } from "@/lib/rankings-web"

/**
 * 本周飙升榜 —— 按相对增速排，但带两个绝对量门槛。
 *
 * `/rankings` 按绝对增量排，因为在一个没有门槛的列表里百分比会把 4 → 8 星的项目顶到
 * 第一。这一页反过来说：相对增速本身是个真问题（「谁在被新发现」），只是必须先挡掉
 * 分母太小的样本。所以这里复用同一个 service 的 `byRelativeGrowth` 排序，再叠一层
 * 编辑口径的门槛——上周至少 {@link MIN_BASE_STARS} 星、本周至少 {@link MIN_DELTA} 星增量
 * ——然后把百分比、增量和分母放在同一行上。
 *
 * 分母跟着百分比一起显示是这一页能不能站住的关键：`+312%` 单独出现时读者无法判断该
 * 有多惊讶，`+312% · 本周 +1,204 · 上周 3,876 星` 才是一个可以拿去做决定的数字。
 *
 * 门槛之后是编辑动作，所以榜单有两条不在页面上的口径：一条是门槛，两条读数取自同一周
 * 的同一份快照；另一条是条数，页面只列前 {@link PAGE_LIMIT}，JSON 接口不限——和
 * `/rankings` 一样，页面是编辑选择，接口是全量。
 */

export const dynamic = "force-dynamic"

/** 上周的星标数门槛：分母小于这个数，百分比不可读。 */
const MIN_BASE_STARS = 200

/** 本周的增量门槛：绝对量不够，增长就没有决策价值。 */
const MIN_DELTA = 50

/** 页面保留的条数。 */
const PAGE_LIMIT = 12

/**
 * 取给门槛用的候选数量。
 *
 * 门槛是排完序才施加的，而 service 会先按相对增速排序再截断，所以这里必须一次要足够
 * 多，才不会在候选池里就已经被截掉那些「基数不够」的项目——它们排在后面，但它们是
 * 需要被门槛看见并淘汰的那一批。
 */
const CANDIDATE_LIMIT = 500

export const metadata: Metadata = {
  title: "本周飙升榜 — OpenMCP 雷达",
  description:
    "本周星标涨得最快的项目：上周至少 200 星，本周至少 +50 星。",
  alternates: { canonical: "/rankings/rising" },
  openGraph: {
    type: "website",
    title: "本周飙升榜 — OpenMCP 雷达",
    description: "按上周星标数的比例排序。",
    url: "https://radar.openmcp.cn/rankings/rising",
  },
}

export default async function PublicRisingRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; week?: string }>
}) {
  const params = new URLSearchParams(
    Object.entries(await searchParams).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
  const resolved = resolveWeek(params)
  const week = resolved.ok ? resolved.value : undefined
  const previous = week ? previousIsoWeek(week) : undefined

  // Both periods from one render: a reader comparing this week with last week is
  // the reader this page exists for, and two requests answer that question with
  // two moments in time that are rarely the same one.
  const [current, last] =
    week && previous
      ? await Promise.all([
          buildRankingsForWeek(db, week, { limit: CANDIDATE_LIMIT }),
          buildRankingsForWeek(db, previous, { limit: CANDIDATE_LIMIT }),
        ])
      : [undefined, undefined]

  const rising = (current?.trending ?? []).filter(passesFloor)
  const previouslyRising = (last?.trending ?? []).filter(passesFloor)

  const groups: PublicProjectGroup[] = [
    {
      title: "本周飙升",
      deltaLabel: "本周增量",
      growthBaseLabel: "上周",
      periodLabel: week ? weekLabel(week) : undefined,
      items: rising.slice(0, PAGE_LIMIT).map(toItem),
      emptyLabel: emptyLabel(week),
    },
    {
      title: "上周飙升",
      deltaLabel: "上周增量",
      growthBaseLabel: "上上周",
      periodLabel: previous ? weekLabel(previous) : undefined,
      items: previouslyRising.slice(0, PAGE_LIMIT).map(toItem),
      emptyLabel: previous
        ? `${weekLabel(previous)} 没有项目越过门槛。`
        : "上一周没有记录。",
    },
  ]

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title="本周飙升榜"
          description={`按星标涨幅排序。上周至少 ${MIN_BASE_STARS} 星，本周至少 +${MIN_DELTA} 星。`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <LocaleLink
              href="/rankings"
              className="rounded-lg border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              按增量排序的榜单
            </LocaleLink>
            {week ? (
              <span className="text-xs text-muted-foreground">
                {weekLabel(week)}
              </span>
            ) : null}
          </div>
        </PublicPageHeader>

        {!resolved.ok && (
          <p className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            参数无效：{resolved.error}
          </p>
        )}

        {resolved.ok && (
          <div className="mt-6">
            <PublicProjectBoard groups={groups} />
          </div>
        )}

        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          门槛只影响这张榜。任意周期的数据在{" "}
          <code>/api/rankings/week.json</code>，含 <code>relativeGrowth</code>，不限条数。
        </p>
      </div>
    </PublicShell>
  )
}

/**
 * The two floors, as one predicate.
 *
 * Both are absolute on purpose: the base guards the ratio from being noise, the
 * gain guards it from being irrelevant. Either alone would let a project through —
 * a steady 900-star project adding 40 stars is not what this list is for.
 */
function passesFloor(project: RankedProject): boolean {
  return starsBefore(project) >= MIN_BASE_STARS && project.delta >= MIN_DELTA
}

/**
 * Stargazers before the week, i.e. the denominator `relativeGrowth` was computed
 * from.
 *
 * Recovered from the week's own reading rather than read out of the service: the
 * service reports the count after the period and the growth during it, and this is
 * the one subtraction that both agree on. Projects with a null ratio are filtered
 * out by {@link passesFloor} anyway, so the `Math.max` never decides a row.
 */
function starsBefore(project: RankedProject): number {
  return Math.max(0, project.stars - project.delta)
}

/**
 * One ranked project as the board's item, carrying the ratio and its denominator.
 *
 * The base is recomputed here rather than carried by the service for the same
 * reason the service does not sort on it: the page needs it to *display* the
 * ratio, and a display-only column has no business in a ranking's identity.
 */
function toItem(project: RankedProject): PublicProjectItem {
  return {
    id: project.fullName,
    owner: project.fullName.split("/")[0] ?? project.fullName,
    name: project.name,
    fullName: project.fullName,
    description: project.description,
    stars: project.stars,
    type: "",
    status: "active",
    tags: project.tags,
    logo: project.logo,
    iconUrl: project.iconUrl,
    avatar: project.avatar,
    delta: project.delta,
    relativeGrowth: project.relativeGrowth,
    growthBase: starsBefore(project),
  }
}

function emptyLabel(week: YearWeek | undefined): string {
  return `本周没有项目越过门槛：上周至少 ${MIN_BASE_STARS} 星，本周至少 +${MIN_DELTA} 星。${
    week ? `${weekLabel(week)} 的` : ""
  }全量数据在 /api/rankings/week.json，不过门槛。`
}

function weekLabel(week: YearWeek): string {
  return `${week.year} 第 ${week.week} 周`
}
