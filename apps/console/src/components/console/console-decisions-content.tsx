"use client"

import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { IconArrowRight, IconGitCompare } from "@tabler/icons-react"
import { DecisionCreateDialog } from "@/components/decisions/decision-create-dialog"
import { LocaleLink } from "@/i18n/navigation"
import { useFormats } from "@/lib/i18n/format"
import { useTRPC } from "@/lib/trpc/client"

/**
 * 决策工作台的清单页。
 *
 * 之前这个页面第一眼是一个空表单加下面若干张已经展开的工作台卡片：新建是最显眼的
 * 元素，而「一份工作台是什么」从来没人说过。于是这个页面被拆成三段，按人的实际顺序：
 *
 * 1. **怎么用**（三步）。它回答的是「我该拿这个干什么」，也解释了一句反直觉的规则：
 *    候选的体征在**加入那一刻**被冻结，之后不会变。
 * 2. **清单**。一行一份工作台，带候选数与状态——「这份还差几个候选」是挑一份打开的
 *    理由，而一张要展开才能读的卡片表不出这个。
 * 3. **新建**。收进弹窗。它是一次性的动作，不该占掉清单上方一整块视觉重量。
 *
 * 详情在 `/console/decisions/[id]`：候选、冻结的体征、结论都在那里。清单页因此不必
 * 承担任何写操作，它只需要让人找到该打开哪一份。
 */
export function ConsoleDecisionsContent() {
  const t = useTranslations("Decisions")
  const formats = useFormats()
  const trpc = useTRPC()

  // No refetch on focus, for the reason `/console/subscriptions` gives: a
  // background refetch reorders a list this short, and moving a row out from
  // under the cursor is a worse trade than pressing refresh.
  const boards = useQuery(
    trpc.decisions.list.queryOptions(undefined, {
      refetchOnWindowFocus: false,
    })
  )

  const items = boards.data?.boards ?? []
  // Read as "2 / 5", and the 5 comes from the server rather than a copy of the
  // rule here. It is only read inside the table, which renders once the query has
  // answered, so the fallback is never the one on screen.
  const maxCandidates = boards.data?.maxCandidates ?? 0

  return (
    <div className="grid gap-4">
      <HowItWorks />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconGitCompare className="size-4" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
          <CardAction>
            <DecisionCreateDialog />
          </CardAction>
        </CardHeader>
        <CardContent>
          {boards.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : items.length === 0 ? (
            <EmptyBoard />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.board")}</TableHead>
                  <TableHead>{t("column.candidates")}</TableHead>
                  <TableHead>{t("column.status")}</TableHead>
                  <TableHead>{t("column.updated")}</TableHead>
                  <TableHead className="text-right">
                    {t("column.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((board) => (
                  <TableRow key={board.id}>
                    <TableCell>
                      <LocaleLink
                        href={`/console/decisions/${board.id}` as never}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {board.title}
                      </LocaleLink>
                      {board.summary ? (
                        <span className="block max-w-96 truncate text-xs text-muted-foreground">
                          {board.summary}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {t("candidatesCount", {
                        count: board.candidateCount,
                        max: maxCandidates,
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {t(`status.${board.status}`)}
                      </Badge>
                      {board.outcome ? (
                        <span className="mt-1 block max-w-72 truncate text-xs text-muted-foreground">
                          {board.outcome}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(board.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <LocaleLink
                          href={`/console/decisions/${board.id}` as never}
                        >
                          {t("open")}
                          <IconArrowRight />
                        </LocaleLink>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * 三步说明，常驻在清单上方。
 *
 * 常驻而不是只在空态里：第二次回来的人不需要它，但删掉它就得让每一个还没开始的人
 * 先猜一次这个工具是干什么的。而这三行字是这份页面里唯一解释「冻结」二字的地方，
 * 藏进空态就等于只在第一次出现。
 */
function HowItWorks() {
  const t = useTranslations("Decisions")

  const steps = [
    { title: t("steps.createTitle"), body: t("steps.createBody") },
    { title: t("steps.addTitle"), body: t("steps.addBody") },
    { title: t("steps.decideTitle"), body: t("steps.decideBody") },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("howTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
                {index + 1}
              </span>
              <span className="grid gap-1">
                <span className="text-sm font-medium">{step.title}</span>
                <span className="text-xs text-muted-foreground">
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

function EmptyBoard() {
  const t = useTranslations("Decisions")

  return (
    <Empty className="border border-dashed border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconGitCompare />
        </EmptyMedia>
        <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
        <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <DecisionCreateDialog />
      </EmptyContent>
    </Empty>
  )
}
