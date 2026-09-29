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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import type { Rankings } from "@/lib/github/service/rankings"
import type { RisingStarsReport } from "@/lib/github/service/rising-stars"
import { useTRPC } from "@/lib/trpc/client"

/** Padded so a month value sorts and reads the same as a two-digit one. */
function monthValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

/**
 * The month name comes from the reader's locale, so this formats rather than
 * indexing an English array.
 */
function useFormatMonth() {
  const format = useFormatter()
  return (year: number, month: number) =>
    format.dateTime(new Date(year, month - 1, 1), {
      year: "numeric",
      month: "long",
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
    delta: (value: number) => `+${format.number(value)}`,
    // `Intl` already localises the decimal separator, so a percentage needs
    // no translation of its own.
    growth: (value: number | null) =>
      value === null
        ? "—"
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

function RankingsTable({ rows }: { rows: Row[] }) {
  const t = useTranslations("Rankings")
  const numbers = useFormatNumbers()

  if (rows.length === 0) {
    return <p className="px-4 text-sm text-muted-foreground">{t("noRanked")}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">{t("column.rank")}</TableHead>
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
            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
            <TableCell>
              <div className="font-medium">{row.name}</div>
              <div className="text-xs text-muted-foreground">
                {row.fullName}
              </div>
            </TableCell>
            <TableCell className="text-right">
              {numbers.stars(row.stars)}
            </TableCell>
            <TableCell className="text-right text-emerald-600">
              {numbers.delta(row.delta)}
            </TableCell>
            <TableCell className="text-right">
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
}: {
  title: string
  description: string
  rows: Row[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <RankingsTable rows={rows} />
      </CardContent>
    </Card>
  )
}

/**
 * Picks one week or one month from the periods that hold data.
 *
 * The list comes from the server rather than being generated from the
 * calendar, so a period that was never swept is not offered as a choice that
 * would render empty.
 */
function PeriodSelect({
  id,
  value,
  options,
  fallbackLabel,
  pending,
  onChange,
}: {
  id: string
  value: string
  options: { value: string; label: string }[]
  fallbackLabel: string
  pending: boolean
  onChange: (value: string) => void
}) {
  const t = useTranslations("Rankings")

  return (
    <div className="grid w-full gap-2 sm:w-56">
      <Label htmlFor={id}>{t("period")}</Label>
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
  const [tab, setTab] = React.useState("weekly")

  const periods = useQuery(trpc.rankings.periods.queryOptions())
  const rising = useQuery(trpc.rankings.risingStars.queryOptions({}))

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
  const yearLabel = String(new Date().getFullYear() - 1)

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-3">
        <TabsTrigger value="weekly">{t("weekly")}</TabsTrigger>
        <TabsTrigger value="monthly">{t("monthly")}</TabsTrigger>
        <TabsTrigger value="rising">{t("risingStars")}</TabsTrigger>
      </TabsList>

      <TabsContent value="weekly" className="flex flex-col gap-4">
        <PeriodSelect
          id="rankings-week"
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
        />
        <RankingCard
          title={t("growthTitle")}
          description={t("growthDescription", { period: weekLabel })}
          rows={rankedRows(weekly.data?.byRelativeGrowth ?? [])}
        />
      </TabsContent>

      <TabsContent value="monthly" className="flex flex-col gap-4">
        <PeriodSelect
          id="rankings-month"
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
        />
        <RankingCard
          title={t("growthTitle")}
          description={t("growthDescription", { period: monthLabel })}
          rows={rankedRows(monthly.data?.byRelativeGrowth ?? [])}
        />
      </TabsContent>

      <TabsContent value="rising" className="flex flex-col gap-4">
        <RankingCard
          title={t("risingStars")}
          description={t("risingDescription", { year: yearLabel })}
          rows={risingRows(rising.data?.projects ?? [])}
        />
      </TabsContent>
    </Tabs>
  )
}
