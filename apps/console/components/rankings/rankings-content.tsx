"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
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

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/** Padded so a month value sorts and reads the same as a two-digit one. */
function monthValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

function formatMonth(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? month} ${year}`
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

function formatStars(value: number): string {
  return value.toLocaleString("en-US")
}

function formatDelta(value: number): string {
  return `+${value.toLocaleString("en-US")}`
}

function formatGrowth(value: number | null): string {
  if (value === null) return "—"
  return `${(value * 100).toFixed(1)}%`
}

function TagsCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>
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
  if (rows.length === 0) {
    return (
      <p className="px-4 text-sm text-muted-foreground">
        No ranked projects for this period.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Stars</TableHead>
          <TableHead className="text-right">Delta</TableHead>
          <TableHead className="text-right">Growth</TableHead>
          <TableHead>Tags</TableHead>
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
              {formatStars(row.stars)}
            </TableCell>
            <TableCell className="text-right text-emerald-600">
              {formatDelta(row.delta)}
            </TableCell>
            <TableCell className="text-right">
              {formatGrowth(row.relativeGrowth)}
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
  return (
    <div className="grid w-full gap-2 sm:w-56">
      <Label htmlFor={id}>Period</Label>
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
        label: `Week ${week.week}, ${week.year}`,
      })),
    [periods.data]
  )
  const monthOptions = React.useMemo(
    () =>
      (periods.data?.months ?? []).map((month) => ({
        value: monthValue(month.year, month.month),
        label: formatMonth(month.year, month.month),
      })),
    [periods.data]
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
    ? `Week ${weekly.data.week} of ${weekly.data.year}`
    : "Last complete week"
  const monthLabel = monthly.data?.month
    ? formatMonth(monthly.data.year, monthly.data.month)
    : "Last complete month"
  const yearLabel = String(new Date().getFullYear() - 1)

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-3">
        <TabsTrigger value="weekly">Weekly</TabsTrigger>
        <TabsTrigger value="monthly">Monthly</TabsTrigger>
        <TabsTrigger value="rising">Rising Stars</TabsTrigger>
      </TabsList>

      <TabsContent value="weekly" className="flex flex-col gap-4">
        <PeriodSelect
          id="rankings-week"
          value={week}
          options={weekOptions}
          fallbackLabel="Last complete week"
          pending={periods.isPending}
          onChange={setWeekChoice}
        />
        <RankingCard
          title="Trending by stargazers gained"
          description={`${weekLabel} — the most new stargazers.`}
          rows={rankedRows(weekly.data?.trending ?? [])}
        />
        <RankingCard
          title="By relative growth"
          description={`${weekLabel} — the fastest growers in percentage terms.`}
          rows={rankedRows(weekly.data?.byRelativeGrowth ?? [])}
        />
      </TabsContent>

      <TabsContent value="monthly" className="flex flex-col gap-4">
        <PeriodSelect
          id="rankings-month"
          value={month}
          options={monthOptions}
          fallbackLabel="Last complete month"
          pending={periods.isPending}
          onChange={setMonthChoice}
        />
        <RankingCard
          title="Trending by stargazers gained"
          description={`${monthLabel} — the most new stargazers.`}
          rows={rankedRows(monthly.data?.trending ?? [])}
        />
        <RankingCard
          title="By relative growth"
          description={`${monthLabel} — the fastest growers in percentage terms.`}
          rows={rankedRows(monthly.data?.byRelativeGrowth ?? [])}
        />
      </TabsContent>

      <TabsContent value="rising" className="flex flex-col gap-4">
        <RankingCard
          title="Rising Stars"
          description={`${yearLabel} — the fastest risers of the year.`}
          rows={risingRows(rising.data?.projects ?? [])}
        />
      </TabsContent>
    </Tabs>
  )
}
