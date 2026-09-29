"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { IconRefresh } from "@tabler/icons-react"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import { SyncStatusBadge } from "@/components/status-badge"
import { DataPagination } from "@/components/data-pagination"

/** Rows per page. Enough to scan a failure run, few enough to stay a page. */
const PAGE_SIZE = 20

export function SyncContent() {
  const formats = useFormats()
  const t = useTranslations("Sync")
  const none = useTranslations("Common")("none")
  const kindLabel = useEnumLabel("Kind")
  const triggerLabel = useEnumLabel("Trigger")
  const statusLabel = useEnumLabel("Status")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [status, setStatus] = React.useState<"all" | "failed" | "running" | "success">("all")
  const [page, setPage] = React.useState(1)

  // A new filter starts at the first page: page four of the previous result
  // set is meaningless against a different one, and the request would 404 into
  // an empty table until the operator noticed.
  const effectiveStatus = React.useMemo(
    () => (status === "all" ? {} : { status }),
    [status]
  )
  const effectivePage = React.useMemo(
    () => (status === "all" ? page : 1),
    [status, page]
  )

  const { data, isPending } = useQuery(
    trpc.sync.list.queryOptions({
      ...effectiveStatus,
      limit: PAGE_SIZE,
      offset: (effectivePage - 1) * PAGE_SIZE,
    })
  )

  const jobs = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // A failed job is the row an operator came to fix, so the retry lives on the
  // row itself rather than in a separate page: the error text that explains
  // why it failed is the same row that carries the button that tries again.
  const retry = useMutation(
    trpc.sync.retry.mutationOptions({
      onSuccess: () => {
        toast.success(t("retryStarted"))
        void queryClient.invalidateQueries({ queryKey: trpc.sync.list.queryKey() })
      },
      onError: (error) => {
        toast.error(t("retryFailed"), { description: error.message })
      },
    })
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          {/* The filter was already accepted by the endpoint but never sent, so
              a failed run could not be narrowed to without reading the whole
              log. */}
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger className="w-40" aria-label={t("filterStatus")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("status.all")}</SelectItem>
              <SelectItem value="running">{statusLabel("running")}</SelectItem>
              <SelectItem value="success">{statusLabel("success")}</SelectItem>
              <SelectItem value="failed">{statusLabel("failed")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.kind")}</TableHead>
                  <TableHead>{t("column.target")}</TableHead>
                  <TableHead>{t("column.status")}</TableHead>
                  <TableHead>{t("column.trigger")}</TableHead>
                  <TableHead>{t("column.started")}</TableHead>
                  <TableHead>{t("column.completed")}</TableHead>
                  <TableHead>{t("column.error")}</TableHead>
                  <TableHead className="w-24">{t("column.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={`${job.kind}-${job.id}`}>
                    <TableCell>{kindLabel(job.kind)}</TableCell>
                    <TableCell className="font-medium">{job.ref}</TableCell>
                    <TableCell>
                      <SyncStatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {triggerLabel(job.triggeredBy)}
                      {job.retryCount > 0 ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {t("retried", { count: job.retryCount })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(job.startedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(job.completedAt)}
                    </TableCell>
                    <TableCell>
                      {job.errorMessage ? (
                        <span
                          className="block max-w-60 truncate text-xs text-muted-foreground"
                          title={job.errorMessage}
                        >
                          {job.errorMessage}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{none}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Only a failed project job is retryable; a readme job is
                          one stage of a project sync, and a job still running
                          has nothing to retry yet. */}
                      {job.kind === "project" && job.status === "failed" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            retry.isPending && retry.variables?.id === job.id
                          }
                          onClick={() => retry.mutate({ id: job.id })}
                        >
                          {retry.isPending &&
                          retry.variables?.id === job.id ? (
                            <Spinner />
                          ) : (
                            <IconRefresh />
                          )}
                          {t("retry")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <DataPagination
              page={effectivePage}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
