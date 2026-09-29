"use client"

import { useQuery } from "@tanstack/react-query"
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
import { useTRPC } from "@/lib/trpc/client"
import { formatDuration, formatRelative } from "@/lib/format"

function StatCard({
  title,
  value,
  hint,
  pending,
}: {
  title: string
  value?: number
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
          <div className="text-2xl font-semibold">
            {value?.toLocaleString("en-US") ?? "0"}
          </div>
        )}
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

export function OverviewContent() {
  const trpc = useTRPC()
  const { data, isPending } = useQuery(trpc.overview.snapshot.queryOptions())

  const skills = data?.skills
  const tasks = data?.tasks

  const skillsHint = skills
    ? `${skills.synced} synced · ${skills.pending} pending · ${skills.failed} failed`
    : undefined
  const tasksHint = tasks
    ? `${tasks.enabled} enabled · ${tasks.running} running now`
    : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Repositories"
          value={data?.repos}
          hint="Tracked on GitHub"
          pending={isPending}
        />
        <StatCard
          title="Projects"
          value={data?.projects}
          hint="Curated on the site"
          pending={isPending}
        />
        <StatCard
          title="Skills"
          value={skills?.total}
          hint={skillsHint}
          pending={isPending}
        />
        <StatCard
          title="Scheduled tasks"
          value={tasks?.total}
          hint={tasksHint}
          pending={isPending}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
          <CardDescription>
            Task executions and sync jobs started in the last 24 hours
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="grid gap-6 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <span className="font-medium text-muted-foreground">
                  Task executions
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <Bucket
                    label="Completed"
                    value={data?.executionsToday.completed ?? 0}
                  />
                  <Bucket
                    label="Failed"
                    value={data?.executionsToday.failed ?? 0}
                  />
                  <Bucket
                    label="Running"
                    value={data?.executionsToday.running ?? 0}
                  />
                  <Bucket
                    label="Pending"
                    value={data?.executionsToday.pending ?? 0}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-medium text-muted-foreground">
                  Sync jobs
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <Bucket
                    label="Succeeded"
                    value={data?.jobsToday.success ?? 0}
                  />
                  <Bucket label="Failed" value={data?.jobsToday.failed ?? 0} />
                  <Bucket
                    label="Running"
                    value={data?.jobsToday.running ?? 0}
                  />
                  <Bucket
                    label="Pending"
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
          <CardTitle>Recent task executions</CardTitle>
          <CardDescription>The last scheduled or manual runs</CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (data?.recentExecutions.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Trigger</TableHead>
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
                      {run.triggeredBy}
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
