"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { IconRefresh } from "@tabler/icons-react"
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
import { Input } from "@workspace/ui/components/input"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import { DataPagination } from "@/components/data-pagination"
import {
  RepoCreateDialog,
  RepoEditDialog,
} from "@/components/repos/repo-edit-dialog"
import { RepoDeleteDialog } from "@/components/repos/repo-delete-dialog"

type RepoFilter = "all" | "curated" | "orphan" | "archived"

/** Rows per page. Enough to scan for a repository, few enough to stay a page. */
const PAGE_SIZE = 20

/**
 * How long typing pauses before the search is sent.
 *
 * The search runs on the server, so every keystroke would be a round trip and
 * a query cache entry per prefix.
 */
const SEARCH_DEBOUNCE_MS = 300

export function ReposContent() {
  const formats = useFormats()
  const t = useTranslations("Repos")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [filter, setFilter] = React.useState<RepoFilter>("all")
  const [term, setTerm] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [settled, setSettled] = React.useState<{
    filter: RepoFilter
    search: string
  }>({ filter: "all", search: "" })

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  // A new filter or search starts at the first page: page five of the previous
  // result set is meaningless against a different one, and the request would
  // come back empty until the operator noticed.
  //
  // Adjusted during render rather than in an effect, because the page and the
  // filter are two halves of one value and an effect would paint the stale page
  // once before correcting it.
  if (filter !== settled.filter || search !== settled.search) {
    setSettled({ filter, search })
    setPage(1)
  }

  const { data, isPending } = useQuery(
    trpc.repos.list.queryOptions({
      filter,
      search,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // A manual refresh is the same work the daily sweep does, for one row. It is
  // a button on the row rather than a page action because the row is what is
  // stale, and a page-wide refresh would refresh the other nineteen too.
  const refresh = useMutation(
    trpc.repos.refresh.mutationOptions({
      onSuccess: (result) => {
        if (result.ok) {
          toast.success(
            t("refreshSucceeded", {
              name: `${result.refreshed?.owner ?? ""}/${result.refreshed?.name ?? ""}`,
            })
          )
        } else {
          toast.warning(t("refreshPartial"), {
            description: t("refreshFailedSteps", {
              steps: result.failed.join(", "),
            }),
          })
        }
        void queryClient.invalidateQueries({
          queryKey: trpc.repos.list.queryKey(),
        })
      },
      onError: (error) => {
        toast.error(t("refreshFailed"), { description: error.message })
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
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as RepoFilter)}
          >
            <TabsList>
              <TabsTrigger value="all">{t("tab.all")}</TabsTrigger>
              <TabsTrigger value="curated">{t("tab.curated")}</TabsTrigger>
              <TabsTrigger value="orphan">{t("tab.orphans")}</TabsTrigger>
              <TabsTrigger value="archived">{t("tab.archived")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="max-w-sm"
          />
          <RepoCreateDialog />
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.repository")}</TableHead>
                  <TableHead>{t("column.projects")}</TableHead>
                  <TableHead>{t("column.stars")}</TableHead>
                  <TableHead>{t("column.pushedAt")}</TableHead>
                  <TableHead>{t("column.lastRefresh")}</TableHead>
                  <TableHead className="w-36">{t("column.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((repo) => (
                  <TableRow key={repo.id}>
                    <TableCell>
                      <a
                        className="font-medium underline-offset-4 hover:underline"
                        href={repo.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {repo.fullName}
                      </a>
                      {repo.description ? (
                        <span className="block max-w-80 truncate text-xs text-muted-foreground">
                          {repo.description}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {/* The curation state, which is the reason this page is
                          not the project list: a repository nothing points at
                          still costs a refresh per day. */}
                      {repo.projectCount > 0 ? (
                        <span className="text-sm">
                          {t("projectCount", { count: repo.projectCount })}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {t("orphan")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {repo.stars?.toLocaleString() ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(repo.pushedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {repo.updatedAt
                        ? formats.relative(repo.updatedAt)
                        : t("never")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("refreshRow", { name: repo.fullName })}
                          title={t("refreshRow", { name: repo.fullName })}
                          disabled={
                            refresh.isPending &&
                            refresh.variables?.id === repo.id
                          }
                          onClick={() => refresh.mutate({ id: repo.id })}
                        >
                          {refresh.isPending &&
                          refresh.variables?.id === repo.id ? (
                            <Spinner />
                          ) : (
                            <IconRefresh />
                          )}
                          <span className="sr-only">
                            {t("refreshRow", { name: repo.fullName })}
                          </span>
                        </Button>
                        <RepoEditDialog
                          repo={{
                            id: repo.id,
                            fullName: repo.fullName,
                            description: repo.description,
                            descriptionZh: repo.descriptionZh,
                            homepage: repo.homepage,
                            iconUrl: repo.iconUrl,
                            overrideDescription: repo.overrideDescription,
                            overrideHomepage: repo.overrideHomepage,
                          }}
                        />
                        <RepoDeleteDialog
                          repo={{
                            id: repo.id,
                            fullName: repo.fullName,
                            projectCount: repo.projectCount,
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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
