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
import { TaskStatusBadge } from "@/components/status-badge"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"
import { formatDuration, formatRelative } from "@/lib/format"

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
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

export function OverviewContent() {
  const t = useTranslations("Overview")
  // A namespaced translator cannot reach another namespace with a dotted key,
  // so the execution table borrows the `Tasks` one instead.
  const tasksT = useTranslations("Tasks")
  const format = useFormatter()
  const triggerLabel = useEnumLabel("Trigger")
  const statusLabel = useEnumLabel("Status")
  const trpc = useTRPC()
  const { data, isPending } = useQuery(trpc.overview.snapshot.queryOptions())

  const skills = data?.skills
  const tasks = data?.tasks

  // `undefined` stays `undefined` so the card still shows its skeleton rather
  // than a zero that looks like a real count.
  const count = (value?: number) =>
    value === undefined ? undefined : format.number(value)

  // Built through the message rather than concatenated, so the word order is
  // the translator's to decide and a language that does not put the count
  // first is not forced into doing so.
  const skillsHint = skills
    ? t("skillsHint", {
        synced: skills.synced,
        pending: skills.pending,
        failed: skills.failed,
      })
    : undefined
  const tasksHint = tasks
    ? t("scheduledTasksHint", {
        enabled: tasks.enabled,
        running: tasks.running,
      })
    : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t("repositories")}
          value={count(data?.repos)}
          hint={t("repositoriesHint")}
          pending={isPending}
        />
        <StatCard
          title={t("projects")}
          value={count(data?.projects)}
          hint={t("projectsHint")}
          pending={isPending}
        />
        <StatCard
          title={t("skills")}
          value={count(skills?.total)}
          hint={skillsHint}
          pending={isPending}
        />
        <StatCard
          title={t("scheduledTasks")}
          value={count(tasks?.total)}
          hint={tasksHint}
          pending={isPending}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("today")}</CardTitle>
          <CardDescription>{t("todayDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="grid gap-6 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <span className="font-medium text-muted-foreground">
                  {t("taskExecutions")}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <Bucket
                    label={statusLabel("completed")}
                    value={data?.executionsToday.completed ?? 0}
                  />
                  <Bucket
                    label={statusLabel("failed")}
                    value={data?.executionsToday.failed ?? 0}
                  />
                  <Bucket
                    label={statusLabel("running")}
                    value={data?.executionsToday.running ?? 0}
                  />
                  <Bucket
                    label={statusLabel("pending")}
                    value={data?.executionsToday.pending ?? 0}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-medium text-muted-foreground">
                  {t("syncJobs")}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <Bucket
                    label={statusLabel("success")}
                    value={data?.jobsToday.success ?? 0}
                  />
                  <Bucket
                    label={statusLabel("failed")}
                    value={data?.jobsToday.failed ?? 0}
                  />
                  <Bucket
                    label={statusLabel("running")}
                    value={data?.jobsToday.running ?? 0}
                  />
                  <Bucket
                    label={statusLabel("pending")}
                    value={data?.jobsToday.pending ?? 0}
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("recentExecutions")}</CardTitle>
          <CardDescription>{t("recentExecutionsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (data?.recentExecutions.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noRuns")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tasksT("executionColumn.task")}</TableHead>
                  <TableHead>{tasksT("executionColumn.status")}</TableHead>
                  <TableHead className="text-right">
                    {tasksT("executionColumn.started")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tasksT("executionColumn.duration")}
                  </TableHead>
                  <TableHead>{tasksT("executionColumn.trigger")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.recentExecutions ?? []).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.task}</TableCell>
                    <TableCell>
                      <TaskStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {formatRelative(run.startedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDuration(run.duration)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {triggerLabel(run.triggeredBy)}
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

function Bucket({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between rounded-md border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}
