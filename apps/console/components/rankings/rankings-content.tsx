"use client"

import { useQuery } from "@tanstack/react-query"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
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

export function RankingsContent() {
  const trpc = useTRPC()
  const weekly = useQuery(trpc.rankings.weekly.queryOptions({}))
  const monthly = useQuery(trpc.rankings.monthly.queryOptions({}))
  const rising = useQuery(trpc.rankings.risingStars.queryOptions({}))

  const weekLabel = weekly.data
    ? `Week ${weekly.data.week}`
    : "Last complete week"
  const monthLabel = monthly.data
    ? `Month ${monthly.data.month}`
    : "Last complete month"
  const yearLabel = String(new Date().getFullYear() - 1)

  return (
    <Tabs defaultValue="weekly" className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-3">
        <TabsTrigger value="weekly">Weekly</TabsTrigger>
        <TabsTrigger value="monthly">Monthly</TabsTrigger>
        <TabsTrigger value="rising">Rising Stars</TabsTrigger>
      </TabsList>

      <TabsContent value="weekly" className="flex flex-col gap-4">
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
