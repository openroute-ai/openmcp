"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { IconChevronUp } from "@tabler/icons-react"
import type { Rankings } from "@/lib/github/service/rankings"
import type { RisingStarsReport } from "@/lib/github/service/rising-stars"
import { RisingStarCategoriesDialog } from "@/components/rankings/rising-star-categories-dialog"
import { APP_TIMEZONE } from "@/lib/time"
import { useTRPC } from "@/lib/trpc/client"

/** Padded so a month value sorts and reads the same as a two-digit one. */
function monthValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

/**
 * The month name comes from the reader's locale, so this formats rather than
 * indexing an English array.
 *
 * The date is built in UTC and read in Beijing, which is the only combination
 * that names the month the period actually is: `new Date(year, month - 1, 1)`
 * builds midnight in the *reader's* zone, so a reader east of Beijing would see
 * the previous month's name for a month that has already begun.
 */
function useFormatMonth() {
  const format = useFormatter()
  return (year: number, month: number) =>
    format.dateTime(new Date(Date.UTC(year, month - 1, 1)), {
      year: "numeric",
      month: "long",
      timeZone: APP_TIMEZONE,
    })
}

/** The chosen period, or the newest one available when nothing is chosen. */
function resolvePeriod(
  choice: string | null,
  options: { value: string }[]
): string {
  if (choice && options.some((option) => option.value === choice)) {
    return choice
  }
  return options[0]?.value ?? ""
}

/**
 * Star movement, coloured the way the Chinese market reads it: red is up, green
 * is down. The console's own `--radar-*` tokens, registered in the shared
 * stylesheet but valued locally, so web keeps its palette and the radar gets a
 * red that survives a dark background.
 */
const DELTA_TONE = {
  up: "text-radar-up",
  down: "text-radar-down",
  flat: "text-muted-foreground",
} as const

/** The columns a ranking and the Rising Stars report share. */
interface Row {
  name: string
  fullName: string
  stars: number
  delta: number
  /**
   * `undefined` for the Rising Stars report, where there is no "before" to
   * express a percentage against.
   */
  relativeGrowth: number | null
  tags: string[]
}

function rankedRows(rows: Rankings["trending"]): Row[] {
  return rows.map((row) => ({
    name: row.name,
    fullName: row.fullName,
    stars: row.stars,
    delta: row.delta,
    relativeGrowth: row.relativeGrowth,
    tags: row.tags,
  }))
}

function risingRows(rows: RisingStarsReport["projects"]): Row[] {
  return rows.map((row) => ({
    name: row.name,
    fullName: row.full_name,
    stars: row.stars,
    delta: row.delta,
    relativeGrowth: null,
    tags: row.tags,
  }))
}

function useFormatNumbers() {
  const format = useFormatter()
  return {
    stars: (value: number) => format.number(value),
    /**
     * A signed count, not a magnitude.
     *
     * The prefix used to be a literal `+`, which rendered a drop of 120 stars
     * as `+-120` — and a fixed green class meant a falling project was coloured
     * as the good news. Both are now decided by the sign, and the arrow is a
     * second channel so the reading does not depend on colour alone.
     */
    delta: (value: number) =>
      value > 0
        ? `+${format.number(value)}`
        : value < 0
          ? `\u2212${format.number(Math.abs(value))}`
          : "0",
    // `Intl` already localises the decimal separator, so a percentage needs
    // no translation of its own.
    growth: (value: number | null) =>
      value === null
        ? "\u2014"
        : format.number(value * 100, {
            style: "percent",
            maximumFractionDigits: 1,
          }),
  }
}

function TagsCell({ tags }: { tags: string[] }) {
  const common = useTranslations("Common")
  if (tags.length === 0) {
    return <span className="text-muted-foreground">{common("none")}</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary">
          {tag}
        </Badge>
      ))}
    </div>
  )
}

function RankingsTable({ rows, pending }: { rows: Row[]; pending: boolean }) {
  const t = useTranslations("Rankings")
  const common = useTranslations("Common")
  const numbers = useFormatNumbers()

  if (pending && rows.length === 0) {
    // Not "nothing ranked": a period change refetches, and saying the period is
    // empty while the new numbers are on the way reads as data loss.
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <Spinner />
        {common("loading")}
      </div>
    )
  }

  if (rows.length === 0) {
    return <p className="px-4 text-sm text-muted-foreground">{t("noRanked")}</p>
  }

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-12 pl-4">{t("column.rank")}</TableHead>
          <TableHead>{t("column.name")}</TableHead>
          <TableHead className="text-right">{t("column.stars")}</TableHead>
          <TableHead className="text-right">{t("column.delta")}</TableHead>
          <TableHead className="text-right">{t("column.growth")}</TableHead>
          <TableHead>{t("column.tags")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.fullName}-${index}`}>
            <TableCell className="pl-4 text-muted-foreground tabular-nums">
              {index + 1}
            </TableCell>
            <TableCell>
              <div className="font-medium">{row.name}</div>
              <div className="text-xs text-muted-foreground">
                {row.fullName}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {numbers.stars(row.stars)}
            </TableCell>
            <TableCell
              className={`text-right tabular-nums ${DELTA_TONE[row.delta > 0 ? "up" : row.delta < 0 ? "down" : "flat"]}`}
            >
              {row.delta !== 0 && (
                <IconChevronUp
                  className={`mr-0.5 inline size-3 align-[-1px] ${
                    row.delta > 0 ? "" : "-rotate-180"
                  }`}
                  aria-hidden
                />
              )}
              {numbers.delta(row.delta)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {numbers.growth(row.relativeGrowth)}
            </TableCell>
            <TableCell>
              <TagsCell tags={row.tags} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function RankingCard({
  title,
  description,
  rows,
  pending,
}: {
  title: string
  description: string
  rows: Row[]
  pending: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <RankingsTable rows={rows} pending={pending} />
      </CardContent>
    </Card>
  )
}

/**
 * One ranking family: a heading, the period it is showing, and its tables.
 *
 * The three families are stacked rather than tabbed, because they answer
 * different questions at the same time — "what moved last week", "what moved
 * last month", "what rose this year" — and a tab made two of them invisible,
 * along with whether either had data at all.
 */
function RankingSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Picks one week, one month or one year from the options that hold data.
 *
 * The list comes from the server rather than being generated from the
 * calendar, so a period that was never swept is not offered as a choice that
 * would render empty. `label` is passed in because the three sections are not
 * choosing the same kind of thing — a week and a month are both a "period", a
 * year is not.
 */
function PeriodSelect({
  id,
  label,
  value,
  options,
  fallbackLabel,
  pending,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  fallbackLabel: string
  pending: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="grid w-full gap-2 sm:w-56">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={pending}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={fallbackLabel} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function RankingsContent() {
  const t = useTranslations("Rankings")
  const formatMonth = useFormatMonth()
  const trpc = useTRPC()

  const periods = useQuery(trpc.rankings.periods.queryOptions())
  const risingYears = useQuery(trpc.rankings.risingStarYears.queryOptions())

  /**
   * The newest period on record is the default, and it is the same one the
   * ranking builders would choose on their own, so the page opens on the same
   * numbers the public endpoint publishes.
   */
  const weekOptions = React.useMemo(
    () =>
      (periods.data?.weeks ?? []).map((week) => ({
        value: `${week.year}-${week.week}`,
        label: t("weekOption", { week: week.week, year: week.year }),
      })),
    [periods.data, t]
  )
  const monthOptions = React.useMemo(
    () =>
      (periods.data?.months ?? []).map((month) => ({
        value: monthValue(month.year, month.month),
        label: formatMonth(month.year, month.month),
      })),
    [periods.data, formatMonth]
  )

  // `null` means the newest period on record, which is what the ranking
  // builders would have chosen anyway, so the page opens on the same numbers
  // the public endpoint publishes. A choice that has since dropped off the
  // list falls back to the newest rather than being rendered as invalid.
  const [weekChoice, setWeekChoice] = React.useState<string | null>(null)
  const [monthChoice, setMonthChoice] = React.useState<string | null>(null)

  const week = resolvePeriod(weekChoice, weekOptions)
  const month = resolvePeriod(monthChoice, monthOptions)

  const [weekYear, weekNumber] = week.split("-").map(Number)
  const [monthYear, monthNumber] = month.split("-").map(Number)

  // The Rising Stars report covers a whole calendar year rather than a swept
  // period, so it gets a plain year choice. The list is the years that hold
  // star history, have a stored category configuration, or were already built —
  // anything else would render empty for a reason the operator cannot see.
  const yearOptions = React.useMemo(
    () =>
      (risingYears.data ?? []).map((entry) => ({
        value: String(entry.year),
        label: String(entry.year),
      })),
    [risingYears.data]
  )
  const [risingChoice, setRisingChoice] = React.useState<string | null>(null)
  const risingYear = resolvePeriod(risingChoice, yearOptions)
  const risingYearEntry = React.useMemo(
    () => risingYears.data?.find((entry) => entry.year === Number(risingYear)),
    [risingYears.data, risingYear]
  )
  // Held back until the list arrives. Running the query with no year would let
  // the server pick the last complete year, so the page would fetch that one
  // and then immediately refetch the newest year once the options land — two
  // years of data and a visible flash on every load.
  const rising = useQuery(
    trpc.rankings.risingStars.queryOptions(
      risingYear ? { year: Number(risingYear) } : {},
      { enabled: risingYear !== "" }
    )
  )

  /**
   * Each section refetches off its own period, keyed by that period.
   *
   * Nothing to do on change: the period is part of the query key, so choosing a
   * week refetches the week, choosing a month refetches the month, and the two
   * sections keep the numbers they already have rather than blanking while an
   * unrelated section reloads. Saving categories invalidates every query on the
   * page from the dialog, which is what makes a category edit show up here at
   * the same moment it is saved.
   */
  const weekly = useQuery(
    trpc.rankings.weekly.queryOptions(
      // Year and week are only meaningful together: passing a bare week would
      // default the year to the current one and rank a period nobody swept.
      weekYear && weekNumber ? { year: weekYear, week: weekNumber } : {}
    )
  )
  const monthly = useQuery(
    trpc.rankings.monthly.queryOptions(
      monthYear && monthNumber ? { year: monthYear, month: monthNumber } : {}
    )
  )

  // `week` and `month` are optional on the type because one ranking carries
  // the other field, so the label falls back rather than printing "undefined".
  const weekLabel = weekly.data?.week
    ? t("weekOf", { week: weekly.data.week, year: weekly.data.year })
    : t("lastCompleteWeek")
  const monthLabel = monthly.data?.month
    ? formatMonth(monthly.data.year, monthly.data.month)
    : t("lastCompleteMonth")
  // The year the report was actually built for, not a calendar guess: an empty
  // selection falls back to whatever the builder chose, and the heading has to
  // name the same year the rows below belong to.
  const yearLabel =
    rising.data && risingYear ? risingYear : t("risingDefaultYear")

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground">{t("timezoneNote")}</p>

      <RankingSection title={t("weekly")}>
        <PeriodSelect
          id="rankings-week"
          label={t("period")}
          value={week}
          options={weekOptions}
          fallbackLabel={t("lastCompleteWeek")}
          pending={periods.isPending}
          onChange={setWeekChoice}
        />
        <RankingCard
          title={t("trendingTitle")}
          description={t("trendingDescription", { period: weekLabel })}
          rows={rankedRows(weekly.data?.trending ?? [])}
          pending={weekly.isPending}
        />
        <RankingCard
          title={t("growthTitle")}
          description={t("growthDescription", { period: weekLabel })}
          rows={rankedRows(weekly.data?.byRelativeGrowth ?? [])}
          pending={weekly.isPending}
        />
      </RankingSection>

      <RankingSection title={t("monthly")}>
        <PeriodSelect
          id="rankings-month"
          label={t("period")}
          value={month}
          options={monthOptions}
          fallbackLabel={t("lastCompleteMonth")}
          pending={periods.isPending}
          onChange={setMonthChoice}
        />
        <RankingCard
          title={t("trendingTitle")}
          description={t("trendingDescription", { period: monthLabel })}
          rows={rankedRows(monthly.data?.trending ?? [])}
          pending={monthly.isPending}
        />
        <RankingCard
          title={t("growthTitle")}
          description={t("growthDescription", { period: monthLabel })}
          rows={rankedRows(monthly.data?.byRelativeGrowth ?? [])}
          pending={monthly.isPending}
        />
      </RankingSection>

      <RankingSection title={t("risingStars")}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <PeriodSelect
            id="rankings-rising-year"
            label={t("year")}
            value={risingYear}
            options={yearOptions}
            fallbackLabel={t("risingDefaultYear")}
            pending={risingYears.isPending}
            onChange={setRisingChoice}
          />
          {/* Present only once a year is chosen, because editing a year that
              does not exist yet is how an accidental configuration is written. */}
          {risingYear ? (
            <RisingStarCategoriesDialog year={Number(risingYear)} />
          ) : null}
        </div>
        {/* What is actually behind the chosen year. The year list also holds
            these flags, and an operator staring at an empty report has no other
            way to tell "this year has no data yet" from "the configuration is
            wrong" — they are different problems with the same symptom. */}
        {risingYearEntry ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {risingYearEntry.hasHistory ? (
              <Badge variant="secondary">{t("yearState.history")}</Badge>
            ) : null}
            {risingYearEntry.configured ? (
              <Badge variant="secondary">{t("yearState.configured")}</Badge>
            ) : null}
            {risingYearEntry.built ? (
              <Badge variant="secondary">{t("yearState.built")}</Badge>
            ) : null}
            {!risingYearEntry.hasHistory ? (
              <span className="text-muted-foreground">
                {t("yearState.empty")}
              </span>
            ) : null}
          </div>
        ) : null}
        <RankingCard
          title={t("risingStars")}
          description={t("risingDescription", { year: yearLabel })}
          rows={risingRows(rising.data?.projects ?? [])}
          pending={rising.isPending}
        />
      </RankingSection>
    </div>
  )
}
