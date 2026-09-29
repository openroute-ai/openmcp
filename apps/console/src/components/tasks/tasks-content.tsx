"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { isErrorCode, SKIP_CODES } from "@/lib/trpc/error-codes"
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
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"
import { DataPagination } from "@/components/data-pagination"
import { useFormats } from "@/lib/i18n/format"

/** Execution rows per page, matching the other logs. */
const EXECUTIONS_PAGE_SIZE = 20

export function TasksContent() {
  const formats = useFormats()
  const t = useTranslations("Tasks")
  const common = useTranslations("Common")
  const statusLabel = useEnumLabel("Status")
  const taskTypeLabel = useEnumLabel("TaskType")
  const triggerLabel = useEnumLabel("Trigger")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const listKey = trpc.tasks.list.queryKey()
  const executionsKey = trpc.tasks.executions.queryKey({ limit: 50 })

  const { data: tasks = [], isPending } = useQuery(
    trpc.tasks.list.queryOptions()
  )
  const [executionPageIndex, setExecutionPageIndex] = React.useState(1)
  const { data: executionPage } = useQuery(
    trpc.tasks.executions.queryOptions({
      limit: EXECUTIONS_PAGE_SIZE,
      offset: (executionPageIndex - 1) * EXECUTIONS_PAGE_SIZE,
    })
  )
  const executions = executionPage?.items ?? []
  const executionTotal = executionPage?.total ?? 0
  const executionPageCount = Math.max(
    1,
    Math.ceil(executionTotal / EXECUTIONS_PAGE_SIZE)
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
        toast.error(t("updateFailed"))
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
          toast.success(t("runCompleted", { name }))
        } else if (result.status === "skipped") {
          // The server's prose is English, so a known code is translated and
          // anything else is shown as sent: a task whose own skip reason has
          // no code yet reads as English rather than as a code.
          let reason = result.reason
          switch (result.reasonCode) {
            case SKIP_CODES.taskDisabled:
              reason = t("skipDisabled")
              break
            case SKIP_CODES.taskAlreadyRunning:
              reason = t("skipAlreadyRunning")
              break
            case SKIP_CODES.noDataForPeriod:
              reason = t("skipNoData")
              break
            case SKIP_CODES.noDataForYear:
              reason = t("skipNoData")
              break
            case SKIP_CODES.missingNotifyWebhook:
              reason = t("skipMissingNotifyWebhook")
              break
          }
          toast.info(t("runSkipped", { name, reason }))
        } else {
          toast.error(t("runFailed", { name, error: result.error }))
        }
      },
      onError: (error, { name }) => {
        // `appCode` is the server's own translation key. Anything else is a
        // failure the server has not classified, where its message is the only
        // thing there is to show.
        toast.error(
          isErrorCode(error.data?.appCode)
            ? t("runTaskNotFound", { name })
            : error.message
        )
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
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.task")}</TableHead>
                  <TableHead>{t("column.schedule")}</TableHead>
                  <TableHead>{t("column.enabled")}</TableHead>
                  <TableHead>{t("column.state")}</TableHead>
                  <TableHead>{t("column.nextRun")}</TableHead>
                  <TableHead className="text-right">
                    {t("column.lastRun")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("column.actions")}
                  </TableHead>
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
                            {taskTypeLabel(task.taskType)}
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
                          aria-label={t("enableTask", { name: task.name })}
                        />
                      </TableCell>
                      <TableCell>
                        {task.isRunning ? (
                          <span className="flex items-center gap-1.5 text-sm text-sky-600 dark:text-sky-400">
                            <Spinner className="size-3" />
                            {statusLabel("running")}
                          </span>
                        ) : lastStatus ? (
                          <TaskStatusBadge status={lastStatus} />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {t("neverRun")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formats.relative(task.nextRunAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {task.lastExecution ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-sm">
                              {formats.relative(task.lastExecution.startedAt)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formats.duration(task.lastExecution.duration)} ·{" "}
                              {triggerLabel(task.lastExecution.triggeredBy)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {common("none")}
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
                            common("runNow")
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
          <CardTitle>{t("recentExecutions")}</CardTitle>
          <CardDescription>{t("recentExecutionsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noExecutions")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.task")}</TableHead>
                  <TableHead>{t("executionColumn.status")}</TableHead>
                  <TableHead>{t("executionColumn.started")}</TableHead>
                  <TableHead className="text-right">
                    {t("executionColumn.duration")}
                  </TableHead>
                  <TableHead>{t("executionColumn.trigger")}</TableHead>
                  <TableHead>{t("executionColumn.error")}</TableHead>
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
                      {formats.relative(run.startedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formats.duration(run.duration)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {triggerLabel(run.triggeredBy)}
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
                        <span className="text-muted-foreground">
                          {common("none")}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <DataPagination
            page={executionPageIndex}
            pageCount={executionPageCount}
            pageSize={EXECUTIONS_PAGE_SIZE}
            total={executionTotal}
            onPageChange={setExecutionPageIndex}
          />
        </CardContent>
      </Card>
    </div>
  )
}
