"use client"

import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
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
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"
import { formatRelative } from "@/lib/format"
import { SyncStatusBadge } from "@/components/status-badge"

export function SyncContent() {
  const t = useTranslations("Sync")
  const none = useTranslations("Common")("none")
  const kindLabel = useEnumLabel("Kind")
  const triggerLabel = useEnumLabel("Trigger")
  const trpc = useTRPC()
  const { data = [], isPending } = useQuery(
    trpc.sync.list.queryOptions({ limit: 100 })
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((job) => (
                <TableRow key={`${job.kind}-${job.id}`}>
                  <TableCell>{kindLabel(job.kind)}</TableCell>
                  <TableCell className="font-medium">{job.ref}</TableCell>
                  <TableCell>
                    <SyncStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {triggerLabel(job.triggeredBy)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelative(job.startedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelative(job.completedAt)}
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
