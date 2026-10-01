"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Label } from "@workspace/ui/components/label"
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
import { LocaleLink } from "@/i18n/navigation"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useFormats } from "@/lib/i18n/format"
import { useTRPC } from "@/lib/trpc/client"

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
}

/**
 * One task, with its schedule and its execution history.
 *
 * The schedule is the part the list cannot show. `tasks.list` answers "is it on
 * and when does it next run", which is two fields; a `cron` expression that
 * disagrees with the daily/weekly/monthly flags is a misconfiguration, and it is
 * invisible until both are on the same page. So the configuration card puts them
 * side by side rather than letting the summary hide them.
 *
 * Each history row opens its own dialog rather than expanding in place. The
 * content is a run's logs and structured result, which can be tens of thousands
 * of characters; putting that inside the table would make the table's row height
 * depend on a payload nobody reads until they click. `tasks.execution` fetches it
 * when the dialog opens, so the page costs one query instead of a hundred.
 */
export function TaskDetail({ id }: { id: string }) {
  const formats = useFormats()
  const t = useTranslations("TaskDetail")
  const common = useTranslations("Common")
  const typeLabel = useEnumLabel("TaskType")
  const triggerLabel = useEnumLabel("Trigger")
  const statusLabel = useEnumLabel("Status")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const { data, isPending, isError } = useQuery(
    trpc.tasks.byId.queryOptions({ id })
  )

  const setEnabled = useMutation(
    trpc.tasks.setEnabled.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.tasks.byId.queryKey({ id }),
        })
        void queryClient.invalidateQueries({
          queryKey: trpc.tasks.list.queryKey(),
        })
      },
      onError: (error) => {
        toast.error(t("updateFailed"), { description: error.message })
      },
    })
  )

  if (isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("notFoundTitle")}</CardTitle>
          <CardDescription>{t("notFoundDescription")}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const boolean = (value: boolean) => (value ? common("yes") : common("no"))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LocaleLink
          href="/dashboard/tasks"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("backToTasks")}
        </LocaleLink>
        <div className="flex items-center gap-2">
          <Label htmlFor="task-enabled" className="text-sm">
            {t("field.enabled")}
          </Label>
          <Switch
            id="task-enabled"
            checked={data.isEnabled}
            disabled={setEnabled.isPending}
            onCheckedChange={(enabled) =>
              setEnabled.mutate({ name: data.name, enabled })
            }
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">{data.name}</CardTitle>
              <Badge variant="outline">{typeLabel(data.taskType)}</Badge>
              {data.isRunning ? (
                <Badge variant="outline">{t("field.running")}</Badge>
              ) : null}
            </div>
            {data.description ? (
              <CardDescription>{data.description}</CardDescription>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          {/* The three period flags next to the cron expression, on purpose:
              they are the scheduler's own inputs and they can contradict each
              other, and the list page shows only their effect. */}
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("field.name")}>{data.name}</Field>
            <Field label={t("field.type")}>{typeLabel(data.taskType)}</Field>
            <Field label={t("field.cron")}>
              <code className="text-xs">{data.cronExpression}</code>
            </Field>
            <Field label={t("field.daily")}>
              {boolean(data.isDaily)}
            </Field>
            <Field label={t("field.weekly")}>
              {boolean(data.isWeekly)}
            </Field>
            <Field label={t("field.monthly")}>
              {boolean(data.isMonthly)}
            </Field>
            <Field label={t("field.state")}>
              {data.isEnabled ? common("yes") : common("no")}
            </Field>
            <Field label={t("field.nextRun")}>
              {/* Two sources, named separately. `nextRunAt` is what the
                  scheduler computed from the executions it has; the stored
                  column is the last value written. They disagree exactly when a
                  task has not run since it was enabled, and collapsing them
                  would report a due time as if it were scheduled. */}
              {data.nextRunAt
                ? formats.dateTime(data.nextRunAt)
                : common("none")}
            </Field>
            <Field label={t("field.storedNextRun")}>
              {data.nextRunAtStored
                ? formats.dateTime(data.nextRunAtStored)
                : common("none")}
            </Field>
            <Field label={t("field.lastRun")}>
              {data.lastRunAt ? formats.relative(data.lastRunAt) : t("never")}
            </Field>
            <Field label={t("field.lastFinished")}>
              {data.lastFinishedAt
                ? formats.relative(data.lastFinishedAt)
                : t("never")}
            </Field>
            <Field label={t("field.lastExecution")}>
              <code className="text-xs">{data.lastExecutionId ?? "—"}</code>
            </Field>
            <Field label={t("field.created")}>
              {formats.dateTime(data.createdAt)}
            </Field>
            <Field label={t("field.updated")}>
              {formats.dateTime(data.updatedAt)}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("statistics")}</CardTitle>
            <CardDescription>{t("statisticsDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("field.totalRuns")}>
              {data.total.toLocaleString()}
            </Field>
            <Field label={t("field.averageDuration")}>
              {/* Null rather than 0 when there is no run: the average of nothing
                  is unknown, and "0 ms" would claim the task is instant. */}
              {data.averageDuration == null
                ? common("none")
                : formats.duration(data.averageDuration)}
            </Field>
            <Field label={t("field.firstRun")}>
              {data.firstRunAt
                ? formats.dateTime(data.firstRunAt)
                : t("never")}
            </Field>
            <Field label={t("field.lastFinished")}>
              {data.lastFinishedAt
                ? formats.relative(data.lastFinishedAt)
                : t("never")}
            </Field>
          </dl>

          {/* Only the statuses this task has actually recorded. Rendering all
              five with zeros would make a task that has only ever succeeded
              look like it has failed, cancelled and is waiting five times over. */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.byStatus).map(([status, count]) => (
              <Badge key={status} variant="outline">
                {statusLabel(status)}: {count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("history")}</CardTitle>
            <CardDescription>
              {t("historyDescription", { count: data.executions.length })}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.executions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.status")}</TableHead>
                  <TableHead>{t("column.started")}</TableHead>
                  <TableHead>{t("column.duration")}</TableHead>
                  <TableHead>{t("column.trigger")}</TableHead>
                  <TableHead>{t("column.error")}</TableHead>
                  <TableHead className="w-24">
                    {t("column.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.executions.map((execution) => (
                  <TableRow key={execution.id}>
                    <TableCell>
                      <TaskStatusBadge status={execution.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {execution.startedAt
                        ? formats.dateTime(execution.startedAt)
                        : formats.dateTime(execution.createdAt)}
                    </TableCell>
                    <TableCell>
                      {execution.duration == null
                        ? common("none")
                        : formats.duration(execution.duration)}
                    </TableCell>
                    <TableCell>
                      {triggerLabel(execution.triggeredBy)}
                    </TableCell>
                    <TableCell className="max-w-72">
                      {execution.error ? (
                        <span className="line-clamp-2 text-xs text-destructive">
                          {execution.error}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {common("none")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ExecutionDialog
                        executionId={execution.id}
                        taskName={data.name}
                      />
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
 * One execution's full record, fetched when the dialog opens.
 *
 * `useQuery` inside a dialog rather than a prop drilled down from the page: the
 * logs and result are the only reason this dialog exists, and a task's history
 * can be a hundred rows of payloads that nobody opened.
 *
 * Disabled until open so a closed dialog holds no cache entry, which is what
 * keeps the page's query count at one rather than one per history row.
 */
function ExecutionDialog({
  executionId,
  taskName,
}: {
  executionId: string
  taskName: string
}) {
  const t = useTranslations("TaskDetail")
  const common = useTranslations("Common")
  const formats = useFormats()
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)

  const { data, isPending, isError } = useQuery(
    trpc.tasks.execution.queryOptions({ id: executionId }, { enabled: open })
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          {t("openRun")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("runTitle", { id: executionId })}</DialogTitle>
          <DialogDescription>{taskName}</DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            {t("runTaskNotFound")}
          </p>
        ) : (
          <div className="grid gap-4">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label={t("column.status")}>
                <TaskStatusBadge status={data.status} />
              </Field>
              <Field label={t("column.trigger")}>
                {data.triggeredBy}
              </Field>
              <Field label={t("column.started")}>
                {data.startedAt
                  ? formats.dateTime(data.startedAt)
                  : common("none")}
              </Field>
              <Field label={t("column.duration")}>
                {data.duration == null
                  ? common("none")
                  : formats.duration(data.duration)}
              </Field>
            </dl>

            {data.error ? (
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  {t("errorTitle")}
                </span>
                <pre className="max-h-40 overflow-auto rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {data.error}
                </pre>
              </div>
            ) : null}

            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">
                {t("resultTitle")}
              </span>
              {/* Rendered as text, not parsed: `result` is whatever the task
                  chose to store, and a task that stores a string would break
                  JSON.parse for the reader. */}
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">
                {data.result ? (
                  typeof data.result === "string"
                    ? data.result
                    : JSON.stringify(data.result, null, 2)
                ) : (
                  t("noResult")
                )}
              </pre>
            </div>

            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">
                {t("logsTitle")}
              </span>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2 text-xs">
                {data.logs ?? t("noLogs")}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{common("cancel")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}