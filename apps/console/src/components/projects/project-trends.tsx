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

/** How tall a full bar is, in pixels. */
const MAX_BAR_HEIGHT = 120

/** Bar width, and the gap between bars, as a share of the chart width. */
const BAR_WIDTH_PERCENT = 55

interface Bar {
  key: string
  label: string
  value: number | undefined
  /** The full label, for the tooltip and the small-screen readout. */
  title: string
}

/**
 * A row of bars, one per month or week.
 *
 * The bars are plain divs rather than a chart library: there is one series, it
 * is a dozen values, and nothing here needs axes, zoom or a legend. A library
 * would add a dependency and a client bundle to render twelve rectangles.
 *
 * Every bar is a button, so a value is reachable by keyboard and readable by a
 * screen reader through the same `aria-label` the tooltip shows. The value is
 * not rendered as visible text above each bar because at twelve bars the numbers
 * collide with each other and with the bar tops at every width below a wide
 * desktop; the selected bar's value is shown in a readout instead, which is also
 * the only way to read one on a phone.
 */
function BarChart({
  bars,
  unit,
  emptyLabel,
}: {
  bars: Bar[]
  unit: string
  emptyLabel: string
}) {
  const t = useTranslations("ProjectDetail")
  const [selected, setSelected] = React.useState<string | null>(null)

  // Scaled against the largest value present, and over the absolute values
  // rather than the deltas: a repository that gained 12 stars every month for a
  // year should show twelve equal bars, not twelve bars scaled to whichever
  // month happened to spike.
  const values = bars
    .map((bar) => bar.value)
    .filter((value): value is number => value !== undefined)
  const max = values.length > 0 ? Math.max(...values, 0) : 0

  const readout = bars.find((bar) => bar.key === selected)

  if (values.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div className="grid gap-2">
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
        {readout
          ? t("trendReadout", {
              period: readout.title,
              value: readout.value ?? 0,
              unit,
            })
          : t("trendHint")}
      </p>

      <div className="flex items-end gap-1">
        {bars.map((bar) => {
          const height =
            bar.value === undefined
              ? 0
              : max === 0
                ? 0
                : Math.max(2, Math.round((bar.value / max) * MAX_BAR_HEIGHT))
          const isSelected = bar.key === selected

          return (
            <button
              key={bar.key}
              type="button"
              // A bar with no value is drawn as a gap and is not focusable:
              // there is nothing behind it to read.
              disabled={bar.value === undefined}
              onClick={() => setSelected(isSelected ? null : bar.key)}
              aria-label={bar.title}
              aria-pressed={isSelected}
              title={bar.title}
              className="flex flex-1 flex-col items-center justify-end disabled:cursor-default"
            >
              <span
                className={
                  bar.value === undefined
                    ? "w-3/4 border-b border-dashed border-muted-foreground/40"
                    : isSelected
                      ? "w-3/4 rounded-t bg-primary"
                      : "w-3/4 rounded-t bg-primary/40 hover:bg-primary/60"
                }
                style={{ height }}
              />
            </button>
          )
        })}
      </div>

      <div className="flex gap-1 text-xs text-muted-foreground">
        {bars.map((bar) => (
          <span key={bar.key} className="flex-1 text-center">
            {bar.label}
          </span>
        ))}
      </div>

      <p className="sr-only">
        {bars
          .filter((bar) => bar.value !== undefined)
          .map((bar) =>
            t("trendReadout", { period: bar.title, value: bar.value!, unit })
          )
          .join("; ")}
      </p>
    </div>
  )
}

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

  const monthly: Bar[] = bars.map((bar) => ({
    key: `${bar.yearMonth.year}-${bar.yearMonth.month}`,
    label: String(bar.yearMonth.month),
    value: bar.delta,
    title: t("trendMonthTitle", {
      year: bar.yearMonth.year,
      month: bar.yearMonth.month,
      value: bar.delta ?? 0,
    }),
  }))

  const weekly: Bar[] = weeks.map((week) => ({
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
            <BarChart
              bars={monthly}
              unit={t("trendUnitStars")}
              emptyLabel={t("trendNoMonthlyHistory")}
            />
          </TabsContent>
          <TabsContent value="weekly" className="pt-4">
            <BarChart
              bars={weekly}
              unit={t("trendUnitStars")}
              emptyLabel={t("trendNoWeeklyHistory")}
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
    <div className="grid gap-0.5">
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
