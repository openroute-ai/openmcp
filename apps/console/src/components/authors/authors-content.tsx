"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { Badge } from "@workspace/ui/components/badge"
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
import { AuthorCard } from "@/components/authors/author-card"

/**
 * How long typing pauses before the search is sent.
 *
 * The search runs on the server, so every keystroke would be a round trip and a
 * query cache entry per prefix.
 */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The author directory, as a list of its own.
 *
 * The same rows the project page shows per byline, gathered into one place. An
 * author is derived from the owner of a curated repository, so a directory that
 * only existed inside a project page had no way to answer two questions an
 * operator actually asks: who is on here at all, and whose profile has never
 * been fetched. Both are answered here — the list is ordered by followers, and
 * an author with no follower count is one nothing has been fetched for, which
 * sorts to the bottom rather than hiding.
 *
 * The refresh button is on every row because that is the only way to fill in
 * followers, a bio and a display name for an author the repository sweep
 * created from a bare login.
 */
export function AuthorsContent() {
  const formats = useFormats()
  const format = useFormatter()
  const t = useTranslations("Authors")
  const trpc = useTRPC()
  const [term, setTerm] = React.useState("")
  const [search, setSearch] = React.useState("")

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  const { data, isPending } = useQuery(
    trpc.authors.list.queryOptions(search ? { search } : {})
  )

  const authors = data ?? []
  const incomplete = authors.filter((author) => author.followers == null).length

  return (
    <Card>
      <CardHeader>
        <div className="grid gap-1">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="max-w-sm"
        />
        {/* Said up front rather than left for the operator to infer: a row with
            no follower count is a profile that has never been fetched, and the
            fix is the refresh button on the row rather than anything about the
            repository behind it. */}
        {!isPending && incomplete > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("incompleteCount", { count: incomplete })}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : authors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("column.author")}</TableHead>
                <TableHead>{t("column.details")}</TableHead>
                <TableHead className="text-right">
                  {t("column.followers")}
                </TableHead>
                <TableHead>{t("column.npm")}</TableHead>
                <TableHead>{t("column.status")}</TableHead>
                <TableHead>{t("column.refreshed")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {authors.map((author) => (
                <TableRow key={author.username}>
                  <TableCell>
                    <ul>
                      {/* The card, rather than a reimplementation of it: the
                          refresh button and the editor have to be the same ones
                          the project page uses, or an operator would learn two
                          different sets of controls for one row. */}
                      <AuthorCard author={author} />
                    </ul>
                  </TableCell>
                  <TableCell className="max-w-sm">
                    {author.bio ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {author.bio}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {author.followers == null ? t("noBio") : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {author.followers == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      format.number(author.followers)
                    )}
                  </TableCell>
                  <TableCell>
                    {author.npmUsername ? (
                      <a
                        className="text-sm underline-offset-4 hover:underline"
                        href={`https://www.npmjs.com/~${author.npmUsername}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        npm:~{author.npmUsername}
                      </a>
                    ) : author.npmPackageCount != null ? (
                      <span className="text-sm">
                        {format.number(author.npmPackageCount)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      {author.verified ? (
                        <Badge variant="outline">{t("verified")}</Badge>
                      ) : null}
                      {author.status !== "active" ? (
                        <Badge variant="secondary">{author.status}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {author.updatedAt
                      ? formats.relative(author.updatedAt)
                      : t("never")}
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
