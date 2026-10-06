"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { useFormatter, useTranslations } from "next-intl"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

/** One day of the account's history. `date` is a `YYYY-MM-DD` day. */
export interface ChartAreaPoint {
  date: string
  stars: number
  forks: number
}

/**
 * The ranges the toggle offers, longest first.
 *
 * The order is the order they are read in, so it is also the order a reader
 * expects to find them in: the default is the widest window, and narrowing is
 * the exception rather than the rule.
 */
const RANGES = ["90d", "30d", "7d"] as const
type Range = (typeof RANGES)[number]

/** The window a small screen starts on, because 90 points do not fit in one. */
const MOBILE_RANGE: Range = "7d"

/**
 * How many days each range shows, and the key it filters on.
 *
 * Read from the data rather than from today: the series stops at the last day
 * the stats sweep wrote, so subtracting from the clock would leave the tail of
 * every window empty whenever the sweep is behind — which is exactly when
 * somebody is looking at the chart to find out why.
 */
const RANGE_DAYS: Record<Range, number> = { "90d": 90, "30d": 30, "7d": 7 }

const chartConfig = {
  stars: { labelKey: "stars", color: "var(--color-chart-1)" },
  forks: { labelKey: "forks", color: "var(--color-chart-2)" },
} satisfies Record<string, { labelKey: string; color: string }>

/**
 * The console's history chart: two cumulative series over the account's own
 * repositories.
 *
 * Ported from the `chart-area-interactive` block that ships with shadcn/ui, with
 * the demo's own data left behind — a dashboard that draws invented numbers is
 * worse than no chart, because it is read as a measurement. Everything the demo
 * hardcoded is now a prop or a query: the series, the labels and the empty case.
 *
 * Two differences from the demo, both deliberate:
 *
 * - **Not stacked.** The demo stacks because "desktop + mobile visitors" is a
 *   total. Stars and forks are two independent totals, and stacking them would
 *   draw a sum that answers no question either series was asked.
 * - **Filtered from the last day with data.** See {@link RANGE_DAYS}.
 *
 * The range switcher narrows client-side: at most ninety points arrive, and
 * re-querying per range would put a round trip between a reader and the answer
 * they already paid for.
 */
export function ChartAreaInteractive({
  data,
  pending,
}: {
  data: ChartAreaPoint[]
  pending: boolean
}) {
  const t = useTranslations("Console.chart")
  const format = useFormatter()
  const isMobile = useIsMobile()
  // The chosen range, or `null` while the reader has not chosen one. Held
  // separately from the effective range so the small-screen default is derived
  // during render rather than forced by an effect — an effect that reset the
  // range whenever the viewport changed also undid a deliberate choice, and
  // setting state in an effect is a second render for something render can
  // already answer.
  const [chosen, setChosen] = React.useState<Range | null>(null)
  const range = chosen ?? (isMobile ? MOBILE_RANGE : "90d")

  const visible = React.useMemo(() => {
    const last = data[data.length - 1]
    if (!last) return []
    const days = RANGE_DAYS[range]
    const end = new Date(`${last.date}T00:00:00Z`)
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - (days - 1))
    return data.filter((point) => new Date(`${point.date}T00:00:00Z`) >= start)
  }, [data, range])

  const labels = {
    stars: t("stars"),
    forks: t("forks"),
  }

  const config = React.useMemo(
    () =>
      Object.fromEntries(
        Object.entries(chartConfig).map(([key, entry]) => [
          key,
          { label: labels[entry.labelKey as keyof typeof labels], color: entry.color },
        ])
      ) satisfies ChartConfig,
    // `labels` is rebuilt every render, so it is joined into one dependency by
    // its two strings instead of being listed as an object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  )

  const rangeLabel = (value: Range) => t(`range.${value}` as "range.90d")

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">{t("description")}</span>
          <span className="@[540px]/card:hidden">{t("descriptionShort")}</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(value) => {
              // An empty value is the toggle reporting "deselected", which would
              // leave the chart on the last range while showing no range as
              // chosen.
              if (value) setChosen(value as Range)
            }}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            {RANGES.map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {rangeLabel(value)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={range} onValueChange={(value) => setChosen(value as Range)}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label={t("rangeLabel")}
            >
              <SelectValue placeholder={rangeLabel("90d")} />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {RANGES.map((value) => (
                <SelectItem key={value} value={value} className="rounded-lg">
                  {rangeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {pending ? (
          <Skeleton className="h-[250px] w-full" />
        ) : visible.length === 0 ? (
          // Said rather than drawn: an axis with no points on it reads as "zero
          // stars", which is a measurement this page has not made.
          <div className="flex h-[250px] items-center justify-center px-6 text-center text-muted-foreground text-sm">
            {t("empty")}
          </div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[250px] w-full">
            <AreaChart data={visible}>
              <defs>
                <linearGradient id="fillStars" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-stars)" stopOpacity={1.0} />
                  <stop offset="95%" stopColor="var(--color-stars)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillForks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-forks)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-forks)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => format.dateTime(new Date(String(value)), { month: "short", day: "numeric" })}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    // `value` is whatever recharts read off the XAxis, which is
                    // the `date` string. Stringed rather than cast to a Date type
                    // the prop does not promise.
                    labelFormatter={(value) =>
                      format.dateTime(new Date(String(value)), {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    indicator="dot"
                  />
                }
              />
              <Area dataKey="forks" type="natural" fill="url(#fillForks)" stroke="var(--color-forks)" />
              <Area dataKey="stars" type="natural" fill="url(#fillStars)" stroke="var(--color-stars)" />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}