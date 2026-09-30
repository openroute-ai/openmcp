"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { StarBarChart, type StarBar } from "@/components/projects/star-bars"
import type { DailyStar } from "@/lib/github/service/snapshot"

/**
 * The day / week star chart on the public project page.
 *
 * A client component because the tab switch is state, even though the data
 * arrives as plain props from a server component.
 *
 * The two windows answer different questions and are deliberately not scaled
 * against each other: a week holds about seven times a day's stargazers, so
 * putting them on one axis would flatten the daily bars to nothing. Each tab
 * scales on its own, which is also what makes a spike readable — the question
 * being asked of a daily chart is "was there an unusual day", and that is only
 * answerable against the other days.
 *
 * Every bar is sized to its peak, so a repository whose last 90 days are all
 * zero except for a single spike shows that spike rather than a flat line with
 * a bump the reader has to hunt for.
 */

const UNIT = "个星标"

/** `2026-03-11` → `3/11`. The year is on the readout, not on every bar. */
function shortLabel(day: string): string {
  const [, month, date] = day.split("-")
  return `${Number(month)}/${Number(date)}`
}

/** `2026-03-11` → `2026 年 3 月 11 日`. */
function longLabel(day: string): string {
  const [year, month, date] = day.split("-")
  return `${year} 年 ${Number(month)} 月 ${Number(date)} 日`
}

export function PublicStarTrend({
  days,
  weeks,
  hasWeeklyHistory,
}: {
  days: DailyStar[]
  weeks: { yearWeek: { year: number; week: number }; stars: number }[]
  hasWeeklyHistory: boolean
}) {
  const dailyBars: StarBar[] = days.map((day) => ({
    key: day.day,
    label: shortLabel(day.day),
    value: day.stars,
    title: `${longLabel(day.day)} 新增 ${day.stars} ${UNIT}`,
  }))

  const weeklyBars: StarBar[] = weeks.map((week) => ({
    key: `${week.yearWeek.year}-${week.yearWeek.week}`,
    label: `W${week.yearWeek.week}`,
    value: week.stars,
    title: `${week.yearWeek.year} 年第 ${week.yearWeek.week} 周新增 ${week.stars} ${UNIT}`,
  }))

  const peakDay = dailyBars.reduce<StarBar | undefined>(
    (best, bar) =>
      best === undefined || (bar.value ?? 0) > (best.value ?? 0) ? bar : best,
    undefined
  )

  return (
    <div className="grid gap-4 rounded-xl border border-border p-5">
      <div className="grid gap-1.5">
        <h2 className="font-display text-lg font-bold tracking-tight">星标增长</h2>
        <p className="text-sm text-muted-foreground">
          逐个 stargazer 的到达时间分桶而来。柱高按各自窗口的峰值归一，两张图不共用坐标轴。
        </p>
      </div>

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">按日</TabsTrigger>
          <TabsTrigger value="weekly">按周</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="pt-4">
          <StarBarChart
            bars={dailyBars}
            emptyLabel="还没有日粒度数据。每次采集会补齐最近 90 天，下一次采集后这里才会有曲线。"
            hint="点一根柱子看当天的数字。"
            readout={(bar) => bar.title}
          />
          {peakDay && (peakDay.value ?? 0) > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              窗口内最高的一天是 {longLabel(peakDay.key)}，新增 {peakDay.value} 个星标。
            </p>
          )}
        </TabsContent>

        <TabsContent value="weekly" className="pt-4">
          <StarBarChart
            bars={weeklyBars}
            emptyLabel={
              hasWeeklyHistory
                ? "这个项目还没有周粒度数据，需要先被采集过一次。"
                : "还没有周粒度数据。"
            }
            hint="点一根柱子看那一周的数字。"
            readout={(bar) => bar.title}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
