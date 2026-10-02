"use client"

import * as React from "react"
import { useFormatter, useTranslations } from "next-intl"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { StarBarChart, type StarBar } from "@/components/projects/star-bars"

/**
 * Month-over-month star growth for a project.
 *
 * Reads the two series the sweep records — a monthly running total and a
 * weekly gain — and offers the same window in both. A month is only comparable
 * to the one before it, so the first bar of a gap is left empty rather than
 * drawn as no growth: "unknown" and "nothing happened" are different facts and
 * a chart that merges them reads as a project that had stopped.
 */
export function ProjectTrends({
  bars,
  weeks,
  periods,
  action,
}: {
  bars: {
    yearMonth: { year: number; month: number }
    delta?: number
    total: number
  }[]
  weeks: { yearWeek: { year: number; week: number }; stars: number }[]
  periods: { week?: number; month?: number; year?: number; total?: number }
  /**
   * The manual snapshot control, rendered beside the card title.
   *
   * Passed in rather than built here so the card holds no mutation of its own:
   * the page already owns the resync, its in-flight guard, its job polling and
   * its error toast, and a second trigger would have to duplicate all four or
   * let the two disagree about whether a run is in progress.
   */
  action?: React.ReactNode
}) {
  const t = useTranslations("ProjectDetail")

  const monthly: StarBar[] = bars.map((bar) => ({
    key: `${bar.yearMonth.year}-${bar.yearMonth.month}`,
    label: String(bar.yearMonth.month),
    value: bar.delta,
    title: t("trendMonthTitle", {
      year: bar.yearMonth.year,
      month: bar.yearMonth.month,
      value: bar.delta ?? 0,
    }),
  }))

  const weekly: StarBar[] = weeks.map((week) => ({
    key: `${week.yearWeek.year}-${week.yearWeek.week}`,
    label: String(week.yearWeek.week),
    value: week.stars,
    title: t("trendWeekTitle", {
      year: week.yearWeek.year,
      week: week.yearWeek.week,
      value: week.stars,
    }),
  }))

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="grid gap-1.5">
          <CardTitle>{t("trends")}</CardTitle>
          <CardDescription>{t("trendsDescription")}</CardDescription>
        </div>
        {action}
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TrendFigure
            label={t("trendThisWeek")}
            value={periods.week}
            fallback={t("trendNoData")}
          />
          <TrendFigure
            label={t("trendThisMonth")}
            value={periods.month}
            fallback={t("trendNoData")}
          />
          <TrendFigure
            label={t("trendThisYear")}
            value={periods.year}
            fallback={t("trendNoData")}
          />
          <TrendFigure
            label={t("trendTotalStars")}
            value={periods.total}
            fallback={t("trendNoData")}
            signed={false}
          />
        </dl>

        <Tabs defaultValue="monthly">
          <TabsList>
            <TabsTrigger value="monthly">{t("trendMonthly")}</TabsTrigger>
            <TabsTrigger value="weekly">{t("trendWeekly")}</TabsTrigger>
          </TabsList>
          <TabsContent value="monthly" className="pt-4">
            <StarBarChart
              bars={monthly}
              emptyLabel={t("trendNoMonthlyHistory")}
              hint={t("trendHint")}
              readout={(bar) =>
                t("trendReadout", {
                  period: bar.title,
                  value: bar.value ?? 0,
                  unit: t("trendUnitStars"),
                })
              }
            />
          </TabsContent>
          <TabsContent value="weekly" className="pt-4">
            <StarBarChart
              bars={weekly}
              emptyLabel={t("trendNoWeeklyHistory")}
              hint={t("trendHint")}
              readout={(bar) =>
                t("trendReadout", {
                  period: bar.title,
                  value: bar.value ?? 0,
                  unit: t("trendUnitStars"),
                })
              }
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

/**
 * One headline figure.
 *
 * An undefined value renders as the fallback rather than as zero: the windows
 * here are measured against recorded history, and a repository that has not
 * been swept has no growth to report rather than none.
 */
function TrendFigure({
  label,
  value,
  fallback,
  signed = true,
}: {
  label: string
  value: number | undefined
  fallback: string
  signed?: boolean
}) {
  const format = useFormatter()

  return (
    <div className="grid min-h-[56px] content-center gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">
        {value === undefined ? (
          <span className="text-muted-foreground">{fallback}</span>
        ) : (
          format.number(value, { signDisplay: signed ? "exceptZero" : "auto" })
        )}
      </dd>
    </div>
  )
}
