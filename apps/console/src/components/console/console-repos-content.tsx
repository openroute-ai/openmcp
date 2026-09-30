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
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import { DataPagination } from "@/components/data-pagination"
import { RepoCreateDialog } from "@/components/repos/repo-edit-dialog"
import { LocaleLink } from "@/i18n/navigation"

/** Rows per page. Enough to scan for a repository, few enough to stay a page. */
const PAGE_SIZE = 20

/** How long typing pauses before the search is sent. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The repository list, for an account that may do nothing but read it and add to
 * it.
 *
 * The same `repos.list` query the operator console reads, and the same rows — one
 * list, one source of truth. What is missing is the row actions: refresh, edit
 * and delete are `adminProcedure`, so buttons for them would fail on click, and
 * the edit is an editorial decision in any case. The filter tabs are gone for a
 * related reason: "curated" and "orphans" are the vocabulary of someone deciding
 * what to publish, and there is nothing to decide from here.
 *
 * The project count stays, because it is the one column that answers the
 * question a reader of this list actually has — whether an admin has published
 * the repository yet. The count is also what the detail page turns into names,
 * so a row opens onto the answer rather than onto the number again.
 */
export function ConsoleReposContent() {
  const formats = useFormats()
  const t = useTranslations("Console")
  const repos = useTranslations("Repos")
  const trpc = useTRPC()
  const [term, setTerm] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [settled, setSettled] = React.useState("")

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  // A new search starts at the first page, for the same reason as on the
  // operator console: page five of the previous result set means nothing against
  // a different one. Adjusted during render rather than in an effect, so the
  // page and the term never disagree for a frame.
  if (search !== settled) {
    setSettled(search)
    setPage(1)
  }

  const { data, isPending } = useQuery(
    trpc.repos.list.queryOptions({
      search,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Card>
      <CardHeader>
        <div className="grid gap-1">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={repos("searchPlaceholder")}
            aria-label={repos("searchPlaceholder")}
            className="max-w-sm"
          />
          <RepoCreateDialog />
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{repos("empty")}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{repos("column.repository")}</TableHead>
                  <TableHead>{repos("column.projects")}</TableHead>
                  <TableHead>{repos("column.stars")}</TableHead>
                  <TableHead>{repos("column.pushedAt")}</TableHead>
                  <TableHead>{repos("column.lastRefresh")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((repo) => (
                  <TableRow key={repo.id}>
                    <TableCell>
                      {/*
                        The name goes to the detail page, and GitHub sits beside
                        it as its own link: the detail page is what this console
                        is for, and a row whose only link leaves for another site
                        would make this list a table of outbound links.
                      */}
                      <LocaleLink
                        href={`/console/repos/${repo.id}` as never}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {repo.fullName}
                      </LocaleLink>
                      <a
                        className="block text-xs text-muted-foreground underline-offset-4 hover:underline"
                        href={repo.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("onGitHub")}
                      </a>
                      {repo.description ? (
                        <span className="block max-w-80 truncate text-xs text-muted-foreground">
                          {repo.description}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {repo.projectCount > 0 ? (
                        <span className="text-sm">
                          {repos("projectCount", { count: repo.projectCount })}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {repos("orphan")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {repo.stars?.toLocaleString() ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(repo.pushedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {repo.updatedAt
                        ? formats.relative(repo.updatedAt)
                        : repos("never")}
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
