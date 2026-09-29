"use client"

import { useQuery } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { Button } from "@workspace/ui/components/button"
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
import { ProjectLogo } from "@/components/projects/project-logo"
import { TaskStatusBadge } from "@/components/status-badge"
import { LocaleLink } from "@/i18n/navigation"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"

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
  const formats = useFormats()
  const t = useTranslations("Overview")
  // A namespaced translator cannot reach another namespace with a dotted key,
  // so the execution table borrows the `Tasks` one instead.
  const tasksT = useTranslations("Tasks")
  const format = useFormatter()
  const triggerLabel = useEnumLabel("Trigger")
  const statusLabel = useEnumLabel("Status")
  const typeLabel = useEnumLabel("Type")
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
                      {formats.relative(run.startedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formats.duration(run.duration)}
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="grid gap-1">
              <CardTitle>{t("recentProjects")}</CardTitle>
              <CardDescription>
                {t("recentProjectsDescription")}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <LocaleLink href="/dashboard/projects">
                {t("viewAllProjects")}
                <IconArrowRight />
              </LocaleLink>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (data?.recentProjects.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {data?.recentProjects.map((project) => (
                <li key={project.id}>
                  <LocaleLink
                    href={`/dashboard/projects/${project.id}`}
                    className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent"
                  >
                    <ProjectLogo
                      name={project.name}
                      logo={project.logo}
                      avatar={githubAvatarUrl(project.owner, {
                        ownerId: project.ownerId,
                        // Twice the 32px slot, for a 2x display.
                        size: 64,
                      })}
                      iconUrl={project.iconUrl}
                    />
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {project.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {project.owner} · {typeLabel(project.type)} ·{" "}
                        {formats.relative(project.createdAt)}
                      </span>
                    </div>
                    {project.stars === null || project.stars === undefined ? null : (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {format.number(project.stars)}
                      </span>
                    )}
                  </LocaleLink>
                </li>
              ))}
            </ul>
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
