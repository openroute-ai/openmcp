"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
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
import { useEnumLabel } from "@/lib/i18n/labels"
import { useFormats } from "@/lib/i18n/format"
import { DataPagination } from "@/components/data-pagination"
import { LocaleLink } from "@/i18n/navigation"

/** Rows per page. A directory is scanned for one account, not read end to end. */
const PAGE_SIZE = 20

/**
 * How long typing pauses before the search is sent.
 *
 * The search runs on the server, so every keystroke would be a round trip and a
 * query cache entry per prefix.
 */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The account directory.
 *
 * Ordered by registration rather than by name, and carrying each account's
 * session and submission counts, because those two numbers are what make a row
 * actionable: a name tells you who to look for, and the counts tell you whether
 * looking is worth it.
 *
 * The counts are the reason an operator comes here at all. `/dashboard` is
 * otherwise entirely about the catalog — repositories, projects, skills, tasks —
 * so nothing else on it can answer "who is using this, and what did they submit".
 */
export function UsersContent() {
  const formats = useFormats()
  const t = useTranslations("Users")
  const roleLabel = useEnumLabel("Role")
  const trpc = useTRPC()
  const [term, setTerm] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [role, setRole] = React.useState<"all" | "admin" | "user">("all")
  const [banned, setBanned] = React.useState<"all" | "banned" | "active">(
    "all"
  )
  const [page, setPage] = React.useState(1)
  // The filter and search the current page belongs to. Held separately because
  // typing is continuous and paging is not: page five of the previous results is
  // meaningless against a different result set, and correcting it in an effect
  // would paint the stale page once before fixing it.
  const [settled, setSettled] = React.useState<{
    role: "all" | "admin" | "user"
    banned: "all" | "banned" | "active"
    search: string
  }>({ role: "all", banned: "all", search: "" })

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  if (role !== settled.role || banned !== settled.banned || search !== settled.search) {
    setSettled({ role, banned, search })
    setPage(1)
  }

  const { data, isPending } = useQuery(
    trpc.users.list.queryOptions({
      search: search || undefined,
      role,
      banned,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const users = data?.items ?? []
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
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="max-w-sm"
          />
          <NativeSelect
            value={role}
            aria-label={t("filterRole")}
            onChange={(event) =>
              setRole(event.target.value as "all" | "admin" | "user")
            }
          >
            <NativeSelectOption value="all">{t("role.all")}</NativeSelectOption>
            <NativeSelectOption value="admin">
              {t("role.admin")}
            </NativeSelectOption>
            <NativeSelectOption value="user">
              {t("role.user")}
            </NativeSelectOption>
          </NativeSelect>
          <NativeSelect
            value={banned}
            aria-label={t("filterBanned")}
            onChange={(event) =>
              setBanned(event.target.value as "all" | "banned" | "active")
            }
          >
            <NativeSelectOption value="all">
              {t("bannedState.all")}
            </NativeSelectOption>
            <NativeSelectOption value="banned">
              {t("bannedState.banned")}
            </NativeSelectOption>
            <NativeSelectOption value="active">
              {t("bannedState.active")}
            </NativeSelectOption>
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.user")}</TableHead>
                  <TableHead>{t("column.role")}</TableHead>
                  <TableHead className="text-right">
                    {t("column.sessions")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("column.repos")}
                  </TableHead>
                  <TableHead>{t("column.joined")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <LocaleLink
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/dashboard/users/${row.id}`}
                      >
                        {row.name ?? row.email ?? row.id}
                      </LocaleLink>
                      {row.email && row.name ? (
                        <span className="block max-w-80 truncate text-xs text-muted-foreground">
                          {row.email}
                        </span>
                      ) : null}
                      {row.phoneNumber ? (
                        <span className="block text-xs text-muted-foreground">
                          {row.phoneNumber}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline">
                          {roleLabel(row.role ?? "user")}
                        </Badge>
                        {/* Verification is a fact about the account rather than
                            a state an operator sets, so it is shown next to the
                            role instead of being a separate filter: an account
                            with an unverified email is normal, and only worth
                            noticing in aggregate. */}
                        {row.emailVerified ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-400/40 text-emerald-700 dark:text-emerald-300"
                          >
                            {t("verified")}
                          </Badge>
                        ) : null}
                        {row.banned ? (
                          <Badge
                            variant="outline"
                            className="border-destructive/40 text-destructive"
                          >
                            {t("banned")}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {row.sessionCount}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {row.repoCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.createdAt)}
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