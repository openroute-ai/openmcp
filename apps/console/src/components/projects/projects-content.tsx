"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { SyncStatusBadge } from "@/components/status-badge"
import { CreateProjectDialog } from "@/components/projects/create-project-dialog"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"
import { formatRelative } from "@/lib/format"

export function ProjectsContent() {
  const t = useTranslations("Projects")
  const typeLabel = useEnumLabel("Type")
  const statusLabel = useEnumLabel("Status")
  const trpc = useTRPC()
  const [search, setSearch] = React.useState("")

  const { data: projects = [], isPending } = useQuery(
    trpc.projects.list.queryOptions({ limit: 200 })
  )

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return projects
    return projects.filter((project) =>
      [project.name, project.owner, project.description, project.slug]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term))
    )
  }, [projects, search])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full sm:w-64"
              aria-label={t("searchLabel")}
            />
            <CreateProjectDialog />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("column.project")}</TableHead>
                <TableHead>{t("column.type")}</TableHead>
                <TableHead>{t("column.status")}</TableHead>
                <TableHead className="text-right">
                  {t("column.stars")}
                </TableHead>
                <TableHead className="text-right">
                  {t("column.skills")}
                </TableHead>
                <TableHead>{t("column.pushed")}</TableHead>
                <TableHead>{t("column.lastSync")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <div className="font-medium">{project.name}</div>
                    <div className="text-xs text-muted-foreground">
                      <a
                        href={project.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {project.owner}
                      </a>{" "}
                      · {typeLabel(project.type)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">
                      {typeLabel(project.type)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span>{statusLabel(project.status)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.stars?.toLocaleString() ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.skillCount}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelative(project.pushedAt)}
                  </TableCell>
                  <TableCell>
                    {project.lastSync ? (
                      <div className="flex flex-col items-start gap-1">
                        <SyncStatusBadge status={project.lastSync.status} />
                        <span className="text-xs text-muted-foreground">
                          {formatRelative(project.lastSync.completedAt)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("lastSyncNever")}
                      </span>
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
