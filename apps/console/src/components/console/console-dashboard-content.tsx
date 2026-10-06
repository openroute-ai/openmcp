"use client"

import { useQuery } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { IconArrowRight } from "@tabler/icons-react"
import { ChartAreaInteractive } from "@/components/console/chart-area-interactive"
import { LocaleLink } from "@/i18n/navigation"
import { useTRPC } from "@/lib/trpc/client"

/** How much history the chart is asked for. */
const CHART_DAYS = 90

/** How many recent repositories the list below the chart shows. */
const RECENT_LIMIT = 5

function StatCard({
  title,
  value,
  hint,
  pending,
}: {
  title: string
  /** Already formatted, so the caller's locale decides the grouping. */
  value?: string
  hint?: string
  pending: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {pending ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-2xl font-semibold">{value ?? "0"}</div>
        )}
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

/**
 * What `/console` opens on.
 *
 * The user console used to *be* the repository list, which made it a page with
 * one purpose and no answer to "how is my account doing" — the question someone
 * has when they log in, and the one the operator console answers with a chart
 * they cannot open. So the list moved to `/console/repos` and this page took its
 * place, reading one query built for it: every figure is scoped to the caller's
 * own submissions, which is what `repos.list` shows below it.
 *
 * The numbers are here because they are the ones a submitter cannot get
 * anywhere else. `skillsFailed` is separated from `skillsSynced` rather than
 * folded into a total because the difference between "not pushed yet" and "the
 * push failed" is the difference between waiting and filing a report.
 */
export function ConsoleDashboardContent() {
  const format = useFormatter()
  const t = useTranslations("Console")
  const trpc = useTRPC()

  const { data, isPending } = useQuery(
    trpc.console.overview.queryOptions({ days: CHART_DAYS })
  )

  const { data: recent } = useQuery(
    trpc.repos.list.queryOptions({ filter: "all", limit: RECENT_LIMIT, offset: 0 })
  )

  const totals = data?.totals
  // `undefined` stays `undefined` so a card shows its skeleton rather than a
  // zero that reads as a real count.
  const count = (value?: number) => (value === undefined ? undefined : format.number(value))

  const skillsHint = totals
    ? t("skillsHint", {
        synced: format.number(totals.skillsSynced),
        failed: format.number(totals.skillsFailed),
      })
    : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t("dashboardRepositories")}
          value={count(totals?.repos)}
          hint={t("dashboardRepositoriesHint")}
          pending={isPending}
        />
        <StatCard
          title={t("dashboardProjects")}
          value={count(totals?.projects)}
          hint={t("dashboardProjectsHint")}
          pending={isPending}
        />
        <StatCard title={t("dashboardSkills")} value={count(totals?.skills)} hint={skillsHint} pending={isPending} />
        <StatCard
          title={t("dashboardApiKeys")}
          value={count(totals?.apiKeys)}
          hint={t("dashboardApiKeysHint")}
          pending={isPending}
        />
      </div>

      <ChartAreaInteractive data={data?.series ?? []} pending={isPending} />

      <Card>
        <CardHeader>
          <CardTitle>{t("recentRepositories")}</CardTitle>
          <CardDescription>{t("recentRepositoriesDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {recent?.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("repository")}</TableHead>
                  <TableHead className="text-right">{t("stars")}</TableHead>
                  <TableHead className="text-right">{t("projects")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.items.map((repo) => (
                  <TableRow key={repo.id}>
                    <TableCell className="font-medium">
                      <LocaleLink
                        href={`/console/repos/${repo.id}`}
                        className="hover:underline"
                      >
                        {repo.fullName}
                      </LocaleLink>
                    </TableCell>
                    <TableCell className="text-right">
                      {format.number(repo.stars ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">{format.number(repo.projectCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-6 text-center text-muted-foreground text-sm">
              {t("noRepositories")}
            </p>
          )}
        </CardContent>
        <CardHeader>
          <LocaleLink
            href="/console/repos"
            className="inline-flex items-center gap-1 text-sm hover:underline"
          >
            {t("viewAllRepositories")}
            <IconArrowRight className="size-4" />
          </LocaleLink>
        </CardHeader>
      </Card>
    </div>
  )
}