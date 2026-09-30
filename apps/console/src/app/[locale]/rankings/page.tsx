import { IconArrowDownRight, IconArrowUpRight } from "@tabler/icons-react"

import {
  PublicPageHeader,
  PublicShell,
} from "@/components/public/public-shell"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import { buildRankingsForMonth, buildRankingsForWeek } from "@/lib/github/service/rankings"
import { resolveMonth, resolveWeek } from "@/lib/rankings-web"

/**
 * The public rankings: this week, this month, or a named period.
 *
 * Anonymous and `force-dynamic` for the same reason the sibling JSON endpoints
 * are: a ranking that went stale would read as reality to whoever fetched it, and
 * a stale one is worse than a slow one. The page and `/api/rankings/week.json`
 * therefore answer from the same service with the same default period, so the
 * HTML a reader sees and the JSON an agent reads cannot disagree.
 *
 * The sort is by absolute weekly gain rather than by percentage: a project going
 * from 4 stars to 8 is +100% and belongs nowhere near the top, and a percentage
 * ranking is the single easiest way to make a small list look like a ranking
 * system.
 */

export const dynamic = "force-dynamic"

const RANGES = [
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
] as const

/** Formats a gain with its sign, the way a reader scans a delta column. */
function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`
}

export default async function PublicRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; year?: string; week?: string; month?: string }>
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

  const error = weekResolved && !weekResolved.ok ? weekResolved.error : monthResolved && !monthResolved.ok ? monthResolved.error : undefined

  const rankings = week
    ? await buildRankingsForWeek(db, week)
    : month
      ? await buildRankingsForMonth(db, month)
      : undefined

  const periodLabel = week
    ? `${week.year} 第 ${week.week} 周`
    : month
      ? `${month.year}-${String(month.month).padStart(2, "0")}`
      : range === "month"
        ? "最近一个完整月份"
        : "最近一个完整自然周"

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title="公开榜单"
          description="按区间内的星标绝对增量排序，不用百分比：小基数项目的百分比会骗人。每条数据都能点开看原始时间轴。"
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
            <span className="text-xs text-muted-foreground">{periodLabel}</span>
          </div>
        </PublicPageHeader>

        {error !== undefined && (
          <p className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            参数无效：{error}
          </p>
        )}

        {error === undefined && rankings && rankings.trending.length === 0 && (
          <p className="mt-6 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
            这个区间还没有任何数据。项目需要先被采集过一次，榜单才会有数字。
          </p>
        )}

        {rankings && rankings.trending.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="w-10 py-2 font-medium">#</th>
                  <th className="py-2 font-medium">项目</th>
                  <th className="w-24 py-2 text-right font-medium">星标</th>
                  <th className="w-28 py-2 text-right font-medium">
                    {range === "month" ? "本月增量" : "本周增量"}
                  </th>
                  <th className="hidden w-40 py-2 font-medium sm:table-cell">分类</th>
                </tr>
              </thead>
              <tbody>
                {rankings.trending.map((project, index) => (
                  <tr key={project.fullName} className="border-b border-border/60">
                    <td className="py-2.5 tabular-nums text-muted-foreground">
                      {index + 1}
                    </td>
                    <td className="py-2.5">
                      <LocaleLink
                        href={`/projects/${project.fullName}`}
                        className="font-medium hover:underline"
                      >
                        {project.fullName}
                      </LocaleLink>
                      {project.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {project.description}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {project.stars.toLocaleString("en-US")}
                    </td>
                    <td
                      className={`py-2.5 text-right font-semibold tabular-nums ${
                        project.delta >= 0 ? "text-radar-up" : "text-radar-down"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {project.delta >= 0 ? (
                          <IconArrowUpRight size={14} />
                        ) : (
                          <IconArrowDownRight size={14} />
                        )}
                        {signed(project.delta)}
                      </span>
                    </td>
                    <td className="hidden py-2.5 sm:table-cell">
                      <span className="flex flex-wrap gap-1">
                        {project.tags.map((tag) => (
                          <LocaleLink
                            key={tag}
                            href={`/categories/${tag}`}
                            className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            {tag}
                          </LocaleLink>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-8 text-xs text-muted-foreground">
          同样的数据也可以直接取 JSON：
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono">
            /api/rankings/{range}.json
          </code>
        </p>
      </div>
    </PublicShell>
  )
}
