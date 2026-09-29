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
import { useTRPC } from "@/lib/trpc/client"
import { formatRelative } from "@/lib/format"
import { SyncStatusBadge } from "@/components/status-badge"

export function SyncContent() {
  const trpc = useTRPC()
  const { data = [], isPending } = useQuery(
    trpc.sync.list.queryOptions({ limit: 100 })
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync jobs</CardTitle>
        <CardDescription>
          Project sync jobs and README sync jobs from the last runs
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sync jobs yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((job) => (
                <TableRow key={`${job.kind}-${job.id}`}>
                  <TableCell className="capitalize">{job.kind}</TableCell>
                  <TableCell className="font-medium">{job.ref}</TableCell>
                  <TableCell>
                    <SyncStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {job.triggeredBy}
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
  )
}
