import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import {
  PublicProjectBoard,
  type PublicProjectGroup,
  type PublicProjectItem,
} from "@/components/public/public-project-list"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import {
  buildRankingsForMonth,
  buildRankingsForWeek,
  previousMonth,
  type RankedProject,
} from "@/lib/github/service/rankings"
import {
  previousIsoWeek,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"
import { resolveMonth, resolveWeek } from "@/lib/rankings-web"

/**
 * The public rankings: this week or this month, each beside the period before it.
 *
 * Anonymous and `force-dynamic` for the same reason the sibling JSON endpoints
 * are: a ranking that went stale would read as reality to whoever fetched it, and
 * a stale one is worse than a slow one. The page and `/api/rankings/week.json`
 * therefore answer from the same service with the same default period, so the
 * HTML a reader sees and the JSON an agent reads cannot disagree.
 *
 * Both periods come out of one render, which is the whole reason the previous
 * period is here rather than a link to another page. A reader comparing this
 * week against last week is the reader this ranking exists for, and two pages
 * that load separately answer that question with two moments in time that are
 * rarely the same one.
 *
 * The sort is by absolute gain over the period rather than by percentage: a
 * project going from 4 stars to 8 is +100% and belongs nowhere near the top, and
 * a percentage ranking is the single easiest way to make a small list look like a
 * ranking system. The relative-growth order the service also computes stays in
 * the JSON — it answers a real question, but not the one this page asks.
 *
 * Each period is capped at {@link PAGE_LIMIT}. The cap is the page's editorial
 * choice and the JSON endpoints are not subject to it: an agent asking for a
 * period's data wants all of it, while a reader wants the part that is a ranking.
 * Both are served by the same service with the same sort, so the two answers can
 * only differ in length.
 */

export const dynamic = "force-dynamic"

const RANGES = [
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
] as const

/**
 * How many rows one period's list keeps.
 *
 * A ranking is a statement about the top of something, and "the top 12" is one a
 * reader can hold in their head; the 13th place is not. The full set stays one
 * request away in `/api/rankings/*.json`, which reads from the same service with
 * the same sort, so a capped page and an uncapped endpoint cannot report two
 * different orderings for the same period.
 */
const PAGE_LIMIT = 12

export default async function PublicRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string
    year?: string
    week?: string
    month?: string
  }>
}) {
  const params = new URLSearchParams(
    Object.entries(await searchParams).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
  const range = params.get("range") === "month" ? "month" : "week"

  // Resolved and fetched in two branches rather than merged into one union:
  // a week is (year, week) and a month is (year, month), and collapsing them
  // into a single variable is what forces the casts this code would otherwise
  // need to read a period label off whichever one it got.
  const weekResolved = range === "week" ? resolveWeek(params) : undefined
  const monthResolved = range === "month" ? resolveMonth(params) : undefined

  const week = weekResolved?.ok ? weekResolved.value : undefined
  const month = monthResolved?.ok ? monthResolved.value : undefined

  const error =
    weekResolved && !weekResolved.ok
      ? weekResolved.error
      : monthResolved && !monthResolved.ok
        ? monthResolved.error
        : undefined

  // The previous period is derived from the resolved one rather than read off
  // the query string, so asking for `?year=2026&week=38` compares week 38 with
  // week 37 instead of comparing it with whichever week the default happens to
  // be. Both reads are issued together so the two lists are always the same age.
  const [current, previous] =
    range === "week" && week
      ? await Promise.all([
          buildRankingsForWeek(db, week, { limit: PAGE_LIMIT }),
          buildRankingsForWeek(db, previousIsoWeek(week), {
            limit: PAGE_LIMIT,
          }),
        ])
      : range === "month" && month
        ? await Promise.all([
            buildRankingsForMonth(db, month, { limit: PAGE_LIMIT }),
            buildRankingsForMonth(db, previousMonth(month), {
              limit: PAGE_LIMIT,
            }),
          ])
        : [undefined, undefined]

  // Both periods are described in one place so the two headings cannot end up
  // labelling the same period twice or rolling the month back twice.
  const periods =
    range === "week" && week
      ? [
          {
            title: "本周",
            deltaLabel: "本周增量",
            label: weekLabel(week),
          },
          {
            title: "上周",
            deltaLabel: "上周增量",
            label: weekLabel(previousIsoWeek(week)),
          },
        ]
      : range === "month" && month
        ? [
            {
              title: "本月",
              deltaLabel: "本月增量",
              label: monthLabel(month),
            },
            {
              title: "上月",
              deltaLabel: "上月增量",
              label: monthLabel(previousMonth(month)),
            },
          ]
        : [
            {
              title: range === "month" ? "本月" : "本周",
              deltaLabel: range === "month" ? "本月增量" : "本周增量",
              label: undefined,
            },
            {
              title: range === "month" ? "上月" : "上周",
              deltaLabel: range === "month" ? "上月增量" : "上周增量",
              label: undefined,
            },
          ]

  const groups: PublicProjectGroup[] = [current, previous].map(
    (rankings, index) => ({
      title: periods[index]!.title,
      deltaLabel: periods[index]!.deltaLabel,
      periodLabel: periods[index]!.label,
      items: (rankings?.trending ?? []).map(toItem),
      emptyLabel: index === 0 ? "这一期还没有数据。" : "上一期没有记录。",
    })
  )

  const periodLabel = periods[0]?.label ?? null

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title="公开榜单"
          description="本周和上周星标增量最高的项目。"
        >
          <div className="flex flex-wrap items-center gap-2">
            {RANGES.map((r) => (
              <LocaleLink
                key={r.value}
                href={`/rankings?range=${r.value}`}
                className={
                  r.value === range
                    ? "rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground"
                    : "rounded-lg border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                }
              >
                {r.label}
              </LocaleLink>
            ))}
            {periodLabel ? (
              <span className="text-xs text-muted-foreground">
                {periodLabel}
              </span>
            ) : null}
          </div>
        </PublicPageHeader>

        {error !== undefined && (
          <p className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            参数无效：{error}
          </p>
        )}

        {error === undefined && (
          <div className="mt-6">
            <PublicProjectBoard groups={groups} />
          </div>
        )}

        <p className="mt-8 text-xs text-muted-foreground">
          页面每期列前 {PAGE_LIMIT} 个，全量数据在{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
            /api/rankings/{range}.json
          </code>
          ，排序一致。
        </p>
      </div>
    </PublicShell>
  )
}

/**
 * One ranked project as the board's item.
 *
 * The id is the full name because a ranking is keyed on `repos.owner_name` and
 * carries no project id: reusing the full name keeps the board's key equal to the
 * ranking's own natural key rather than inventing a second one.
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
    anomaly: project.anomaly,
  }
}

function weekLabel(week: YearWeek): string {
  return `${week.year} 第 ${week.week} 周`
}

function monthLabel(month: YearMonth): string {
  return `${month.year}-${String(month.month).padStart(2, "0")}`
}
