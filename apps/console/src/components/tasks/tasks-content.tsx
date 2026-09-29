"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
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

export function TasksContent() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const listKey = trpc.tasks.list.queryKey()
  const executionsKey = trpc.tasks.executions.queryKey({ limit: 50 })

  const { data: tasks = [], isPending } = useQuery(
    trpc.tasks.list.queryOptions()
  )
  const { data: executions = [] } = useQuery(
    trpc.tasks.executions.queryOptions({ limit: 50 })
  )

  const setEnabled = useMutation(
    trpc.tasks.setEnabled.mutationOptions({
      onMutate: async ({ name, enabled }) => {
        await queryClient.cancelQueries({ queryKey: listKey })
        const previous = queryClient.getQueryData(listKey)

        queryClient.setQueryData(listKey, (old) =>
          old?.map((row) =>
            row.name === name ? { ...row, isEnabled: enabled } : row
          )
        )

        return { previous }
      },
      onError: (_error, _input, context) => {
        if (context?.previous) {
          queryClient.setQueryData(listKey, context.previous)
        }
        toast.error("Could not update the task")
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: listKey })
      },
    })
  )

  const runNow = useMutation(
    trpc.tasks.runNow.mutationOptions({
      onSuccess: (result, { name }) => {
        if (result.status === "completed") {
          toast.success(`${name} completed`)
        } else if (result.status === "skipped") {
          toast.info(`${name} skipped: ${result.reason}`)
        } else {
          toast.error(`${name} failed: ${result.error}`)
        }
      },
      onError: (error) => {
        toast.error(error.message)
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: listKey })
        void queryClient.invalidateQueries({ queryKey: executionsKey })
        void queryClient.invalidateQueries({
          queryKey: trpc.overview.snapshot.queryKey(),
        })
      },
    })
  )

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Task definitions</CardTitle>
          <CardDescription>
            The scheduler&apos;s catalogue: schedules run in Asia/Shanghai, and
            disabled tasks are skipped until re-enabled
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No task definitions yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead className="text-right">Last run</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => {
                  const runningNow =
                    runNow.isPending && runNow.variables?.name === task.name
                  const lastStatus = task.lastExecution?.status

                  return (
                    <TableRow key={task.id}>
                      <TableCell>
                        <div className="font-medium">{task.name}</div>
                        <div className="max-w-sm truncate text-xs text-muted-foreground">
                          {task.description}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant="secondary" className="w-fit">
                            {task.taskType}
                          </Badge>
                          {task.cronExpression ? (
                            <code className="text-xs text-muted-foreground">
                              {task.cronExpression}
                            </code>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={task.isEnabled}
                          onCheckedChange={(enabled) =>
                            setEnabled.mutate({ name: task.name, enabled })
                          }
                          aria-label={`Enable ${task.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        {task.isRunning ? (
                          <span className="flex items-center gap-1.5 text-sm text-sky-600 dark:text-sky-400">
                            <Spinner className="size-3" />
                            running
                          </span>
                        ) : lastStatus ? (
                          <TaskStatusBadge status={lastStatus} />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            never run
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(task.nextRunAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {task.lastExecution ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-sm">
                              {formatRelative(task.lastExecution.startedAt)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDuration(task.lastExecution.duration)} ·{" "}
                              {task.lastExecution.triggeredBy}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={runningNow || setEnabled.isPending}
                          onClick={() => runNow.mutate({ name: task.name })}
                        >
                          {runningNow ? (
                            <Spinner className="size-3" />
                          ) : (
                            "Run now"
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent executions</CardTitle>
          <CardDescription>
            The latest 50 runs across every task
          </CardDescription>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No executions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.task}</TableCell>
                    <TableCell>
                      <TaskStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(run.startedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDuration(run.duration)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.triggeredBy}
                    </TableCell>
                    <TableCell>
                      {run.error ? (
                        <span
                          className="block max-w-60 truncate text-xs text-muted-foreground"
                          title={run.error}
                        >
                          {run.error}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
