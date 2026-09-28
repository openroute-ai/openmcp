"use client"

import { useQuery } from "@tanstack/react-query"
import { IconTrendingUp, IconTrendingDown } from "@tabler/icons-react"
import { useTRPC } from "@/lib/trpc/client"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export function SectionCards() {
  const trpc = useTRPC()
  const { data, isPending } = useQuery(
    trpc.stats.overview.queryOptions(undefined, {
      placeholderData: (prev) => prev,
    })
  )

  const total = data?.total ?? 0
  const inProcess = data?.inProcess ?? 0
  const done = data?.done ?? 0
  const reviewers = data?.reviewers ?? 0
  const completionRate = data?.completionRate ?? 0

  const inProcessShare = total === 0 ? 0 : Math.round((inProcess / total) * 100)

  const cards = [
    {
      description: "Total Sections",
      value: total,
      badge: `${inProcessShare}% in process`,
      rising: inProcess > 0,
      note: `${inProcess} currently in process`,
      sub: `${reviewers} distinct reviewers`,
    },
    {
      description: "Completed",
      value: done,
      badge: `${completionRate}% of total`,
      rising: completionRate >= 50,
      note: "Sections marked done",
      sub: `${data?.canceled ?? 0} canceled, ${data?.rejected ?? 0} rejected`,
    },
    {
      description: "Target Sum",
      value: data?.targetSum ?? 0,
      badge: `limit ${data?.limitSum ?? 0}`,
      rising: (data?.targetSum ?? 0) >= (data?.limitSum ?? 0),
      note: "Aggregate target across sections",
      sub: "Sum of every section target",
    },
    {
      description: "Completion Rate",
      value: `${completionRate}%`,
      badge: `${reviewers} reviewers`,
      rising: completionRate >= 50,
      note: "Done as a share of all sections",
      sub: "Recomputed on every query",
    },
  ] as const

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {cards.map((card) => (
        <Card key={card.description} className="@container/card">
          <CardHeader>
            <CardDescription>{card.description}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {isPending ? "—" : card.value}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                {card.rising ? <IconTrendingUp /> : <IconTrendingDown />}
                {card.badge}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {card.note}{" "}
              {card.rising ? (
                <IconTrendingUp className="size-4" />
              ) : (
                <IconTrendingDown className="size-4" />
              )}
            </div>
            <div className="text-muted-foreground">{card.sub}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
