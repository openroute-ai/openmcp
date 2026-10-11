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
import { Input } from "@workspace/ui/components/input"
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
import { IconTrash } from "@tabler/icons-react"
import { LocaleLink } from "@/i18n/navigation"
import { useTRPC } from "@/lib/trpc/client"
import { CategoryFormDialog } from "@/components/categories/category-form-dialog"

/** How long typing pauses before the search is sent. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The category taxonomy's management page.
 *
 * A category is the operator's shelf — the vocabulary the classifier may file a
 * project under and the axis the public `/categories` nav is built from — so this
 * page is where that vocabulary is written. Its rows are small and curated, so
 * the list is not paginated: an operator reads the whole taxonomy at once, which
 * is what "curating a closed set" means.
 *
 * The row's name is a link to the detail page, where the projects filed under the
 * category are listed a page at a time.
 */
export function CategoriesContent() {
  const t = useTranslations("Categories")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [search, setSearch] = React.useState("")
  const [term, setTerm] = React.useState("")

  React.useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isPending } = useQuery(
    trpc.categories.list.queryOptions({ search: term || undefined })
  )
  const rows = data ?? []

  const remove = useMutation(
    trpc.categories.remove.mutationOptions({
      onSuccess: (result) => {
        toast.success(t("deleted", { code: result.code }))
        void queryClient.invalidateQueries({
          queryKey: trpc.categories.list.queryKey(),
        })
      },
      onError: (error) => {
        toast.error(t("deleteFailed"), { description: error.message })
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
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full sm:w-64"
              aria-label={t("searchPlaceholder")}
            />
            <CategoryFormDialog />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {term ? t("emptySearch") : t("empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("column.name")}</TableHead>
                <TableHead>{t("column.code")}</TableHead>
                <TableHead className="text-right">
                  {t("column.sortOrder")}
                </TableHead>
                <TableHead>{t("column.status")}</TableHead>
                <TableHead className="text-right">
                  {t("column.projects")}
                </TableHead>
                <TableHead className="w-24 text-right">
                  {t("column.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <LocaleLink
                      href={`/dashboard/categories/${row.code}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </LocaleLink>
                    {row.description ? (
                      <span className="block max-w-96 truncate text-xs text-muted-foreground">
                        {row.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs text-muted-foreground">
                      {row.code}
                    </code>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {row.sortOrder}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.isActive ? "secondary" : "outline"}>
                      {row.isActive ? t("status.active") : t("status.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <LocaleLink
                      href={`/dashboard/categories/${row.code}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {row.projectCount}
                    </LocaleLink>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <CategoryFormDialog category={row} />
                      <CategoryDeleteButton
                        category={row}
                        pending={
                          remove.isPending && remove.variables?.id === row.id
                        }
                        onConfirm={() => remove.mutate({ id: row.id })}
                      />
                    </div>
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

/**
 * The delete control on a row.
 *
 * A category with projects still deletes — the projects are unfiled, not
 * deleted — but the confirmation says so and names the count, because
 * `ON DELETE SET NULL` losing a classification is quieter than a cascade and
 * easier to do by accident.
 */
function CategoryDeleteButton({
  category,
  pending,
  onConfirm,
}: {
  category: { id: string; name: string; projectCount: number }
  pending: boolean
  onConfirm: () => void
}) {
  const t = useTranslations("Categories")
  const [armed, setArmed] = React.useState(false)

  if (!armed) {
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={t("deleteRow", { name: category.name })}
        title={t("deleteRow", { name: category.name })}
        onClick={() => setArmed(true)}
      >
        <IconTrash />
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        title={
          category.projectCount > 0
            ? t("deleteUnfilesHint", { count: category.projectCount })
            : undefined
        }
        onClick={onConfirm}
      >
        {pending ? <Spinner /> : null}
        {t("deleteConfirm")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
        {t("cancel")}
      </Button>
    </div>
  )
}
