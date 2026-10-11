"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { IconArrowLeft } from "@tabler/icons-react"
import { DataPagination } from "@/components/data-pagination"
import { CategoryFormDialog } from "@/components/categories/category-form-dialog"
import { ProjectLogo } from "@/components/projects/project-logo"
import { LocaleLink } from "@/i18n/navigation"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useFormats } from "@/lib/i18n/format"
import { useTRPC } from "@/lib/trpc/client"
import { PROJECT_SORTS } from "@/db/schema"
import type { ProjectSort } from "@/db/schema"

/** Rows per page. Enough to scan, few enough that a page stays a page. */
const PAGE_SIZE = 20

const SEARCH_DEBOUNCE_MS = 300

const SORT_LABELS = {
  "-stars": "sort.starsDesc",
  stars: "sort.starsAsc",
  "-createdAt": "sort.createdAtDesc",
  createdAt: "sort.createdAtAsc",
} as const satisfies Record<ProjectSort, string>

/**
 * One category, and the projects filed under it.
 *
 * The list is paged and searched on the server (`categories.projects`), so the
 * total and the rows answer the same set and a category with hundreds of
 * projects stays one scroll. Hidden projects are shown here: this is the
 * operator's view of the shelf, not the reader's, and a project being hidden
 * from the public site is a reason to see it in the console rather than out.
 *
 * The category itself is read through the same query, so the header cannot
 * disagree with the rows: a rename or a retirement shows up here on the next
 * load without a second request.
 */
export function CategoryDetailContent({ code }: { code: string }) {
  const t = useTranslations("Categories")
  const typeLabel = useEnumLabel("Type")
  const statusLabel = useEnumLabel("Status")
  const formats = useFormats()
  const trpc = useTRPC()

  const [search, setSearch] = React.useState("")
  const [term, setTerm] = React.useState("")
  const [sort, setSort] = React.useState<ProjectSort>("-stars")
  const [page, setPage] = React.useState(1)
  const [settled, setSettled] = React.useState<{
    term: string
    sort: ProjectSort
  }>({ term: "", sort: "-stars" })

  React.useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // A new search or sort starts at the first page: page five of a different
  // result set is a position in a list that no longer exists. Adjusted during
  // render rather than in an effect so the stale page is never painted.
  if (term !== settled.term || sort !== settled.sort) {
    setSettled({ term, sort })
    setPage(1)
  }

  const { data, isPending } = useQuery(
    trpc.categories.projects.queryOptions({
      code,
      search: term || undefined,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const category = data?.category

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <LocaleLink href="/dashboard/categories">
            <IconArrowLeft />
            {t("backToList")}
          </LocaleLink>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle className="flex items-center gap-2">
                {category?.name ?? code}
                <code className="text-xs font-normal text-muted-foreground">
                  {code}
                </code>
                {category ? (
                  <Badge variant={category.isActive ? "secondary" : "outline"}>
                    {category.isActive
                      ? t("status.active")
                      : t("status.inactive")}
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {category?.description ?? t("noDescription")}
              </CardDescription>
            </div>
            {category ? (
              <CategoryFormDialog
                category={{
                  id: category.id,
                  code: category.code,
                  name: category.name,
                  description: category.description,
                  isActive: category.isActive,
                  sortOrder: category.sortOrder,
                }}
              />
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{t("projectTotal", { count: total })}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("projectSearchPlaceholder")}
              className="w-full sm:w-64"
              aria-label={t("projectSearchPlaceholder")}
            />
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
          </div>

          {isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {term ? t("projectEmptySearch") : t("projectEmpty")}
            </p>
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
                    <TableHead>{t("column.updated")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="pl-4">
                        <ProjectLogo
                          name={project.name}
                          avatar={githubAvatarUrl(project.owner, { size: 64 })}
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
                          {project.owner}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {typeLabel(project.type)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {statusLabel(project.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {project.stars.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formats.relative(
                          project.updatedAt ?? project.createdAt
                        )}
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
    </div>
  )
}
