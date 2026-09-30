"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {} from "@workspace/ui/components/pagination"
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
import { SyncStatusBadge } from "@/components/status-badge"
import { CreateProjectDialog } from "@/components/projects/create-project-dialog"
import { ProjectLogo } from "@/components/projects/project-logo"
import { LocaleLink } from "@/i18n/navigation"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import { DataPagination } from "@/components/data-pagination"
import { PROJECT_SORTS, PROJECT_STATUSES, PROJECT_TYPES } from "@/db/schema"
import type { ProjectSort, ProjectStatus, ProjectType } from "@/db/schema"

/** Rows per page. Enough to scan, few enough that a page stays a page. */
const PAGE_SIZE = 20

/**
 * Sort value to message key.
 *
 * The values are the wire format and read well in a URL, but `-stars` is a poor
 * translation key: the leading dash is punctuation a translator will not know
 * what to do with, and a key is the one thing here that cannot be inferred from
 * its neighbours. A total over `PROJECT_SORTS` is what makes a new order fail
 * the build rather than render blank.
 */
const SORT_LABELS = {
  "-stars": "sort.starsDesc",
  stars: "sort.starsAsc",
  "-createdAt": "sort.createdAtDesc",
  createdAt: "sort.createdAtAsc",
} as const satisfies Record<ProjectSort, string>

/**
 * How long typing pauses before the search is sent.
 *
 * The search runs on the server now, so every keystroke would be a round trip
 * and a query cache entry per prefix. Waiting for a pause makes one request per
 * phrase instead.
 */
const SEARCH_DEBOUNCE_MS = 300

/**
 * How often the table re-reads itself while a row's resync is in flight.
 *
 * A resync is background work measured in minutes, so the button that started
 * it would otherwise sit on a finished job for as long as the operator waited.
 * It stops on its own once no row is outstanding, so a quiet table costs
 * nothing.
 */
const POLL_INTERVAL_MS = 3_000

export function ProjectsContent() {
  const formats = useFormats()
  const t = useTranslations("Projects")
  const typeLabel = useEnumLabel("Type")
  const statusLabel = useEnumLabel("Status")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [search, setSearch] = React.useState("")
  const [term, setTerm] = React.useState("")
  const [status, setStatus] = React.useState<"all" | ProjectStatus>("all")
  const [type, setType] = React.useState<"all" | ProjectType>("all")
  const [sort, setSort] = React.useState<ProjectSort>("-createdAt")
  const [page, setPage] = React.useState(1)
  const [settled, setSettled] = React.useState<{
    term: string
    status: "all" | ProjectStatus
    type: "all" | ProjectType
    sort: ProjectSort
  }>({ term, status: "all", type: "all", sort: "-createdAt" })

  React.useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // A new search starts at the first page: page five of the previous result set
  // is a position in a list that no longer exists, and it usually renders empty
  // rather than as an error.
  //
  // The sort is in here for the same reason even though it changes the order
  // rather than the contents: page five of a different order is a different
  // set of rows, so keeping the offset would show a page that has no relation
  // to the one the operator just asked for.
  //
  // Adjusted during render rather than in an effect, because the page and the
  // term are two halves of one value and an effect would paint the stale page
  // once before correcting it.
  if (
    term !== settled.term ||
    status !== settled.status ||
    type !== settled.type ||
    sort !== settled.sort
  ) {
    setSettled({ term, status, type, sort })
    setPage(1)
  }

  const { data, isPending } = useQuery(
    trpc.projects.list.queryOptions({
      search: term || undefined,
      status: status === "all" ? undefined : status,
      type: type === "all" ? undefined : type,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const sync = useMutation(
    trpc.projects.sync.mutationOptions({
      onSuccess: () => {
        // A resync runs in the background for minutes, so without this the
        // click looks like nothing happened until the badge changes a while
        // later.
        toast.success(t("syncStarted"))
        void queryClient.invalidateQueries({
          queryKey: trpc.projects.list.queryKey(),
        })
      },
      onError: (error) => {
        toast.error(t("syncFailed"), { description: error.message })
      },
    })
  )

  // The row being resynced right now. Held here rather than read off the
  // mutation alone, so the button also covers the seconds between the click and
  // the job row appearing in the list.
  const syncingId = sync.isPending ? (sync.variables?.id ?? null) : null

  const outstanding = items.some(
    (project) =>
      project.lastSync?.status === "pending" ||
      project.lastSync?.status === "running"
  )

  React.useEffect(() => {
    if (!outstanding) return
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: trpc.projects.list.queryKey(),
      })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [outstanding, queryClient, trpc.projects.list])

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
            {/* The endpoint already accepted a status filter; nothing sent it,
                so a list of a few hundred projects could not be narrowed to the
                ones that were hidden or deprecated. */}
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as typeof status)}
            >
              <SelectTrigger className="w-44" aria-label={t("filterStatus")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("status.all")}</SelectItem>
                {PROJECT_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {statusLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* The type is the other half of what a project *is*, and it was
                only ever shown as a column. Five types in a list of a few
                hundred is a set narrow enough to be worth a control. */}
            <Select
              value={type}
              onValueChange={(value) => setType(value as typeof type)}
            >
              <SelectTrigger className="w-40" aria-label={t("filterType")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("type.all")}</SelectItem>
                {PROJECT_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {typeLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(value) => setSort(value as ProjectSort)}
            >
              <SelectTrigger className="w-48" aria-label={t("sortLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_SORTS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(SORT_LABELS[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CreateProjectDialog />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12 pl-4">
                    <span className="sr-only">{t("column.logo")}</span>
                  </TableHead>
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
                  <TableHead className="text-right">
                    <span className="sr-only">{t("column.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((project) => {
                  const busy =
                    syncingId === project.id ||
                    project.lastSync?.status === "pending" ||
                    project.lastSync?.status === "running"

                  return (
                    <TableRow key={project.id}>
                      <TableCell className="pl-4">
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
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          <LocaleLink
                            href={`/dashboard/projects/${project.id}`}
                            className="hover:underline"
                          >
                            {project.name}
                          </LocaleLink>
                        </div>
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
                        {formats.relative(project.pushedAt)}
                      </TableCell>
                      <TableCell>
                        {project.lastSync ? (
                          <div className="flex flex-col items-start gap-1">
                            <SyncStatusBadge status={project.lastSync.status} />
                            <span className="text-xs text-muted-foreground">
                              {formats.relative(project.lastSync.completedAt)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            {t("lastSyncNever")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={busy}
                          title={t("syncRow")}
                          onClick={() => sync.mutate({ id: project.id })}
                        >
                          {busy ? <Spinner /> : <IconRefresh />}
                          <span className="sr-only">{t("syncRow")}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <DataPagination
              page={page}
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
