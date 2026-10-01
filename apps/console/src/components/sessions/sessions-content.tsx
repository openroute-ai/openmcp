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
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Button } from "@workspace/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import { DataPagination } from "@/components/data-pagination"
import { LocaleLink } from "@/i18n/navigation"

/** Rows per page. Matches the account directory: a log an operator scans. */
const PAGE_SIZE = 20

/**
 * How long typing pauses before the search is sent.
 *
 * The search runs on the server, so every keystroke would be a round trip and a
 * query cache entry per prefix.
 */
const SEARCH_DEBOUNCE_MS = 300

/**
 * Every signed-in session, newest first.
 *
 * This page exists for one job: when an account is compromised, somebody has to
 * be able to end the session without waiting for it to expire. So the revoke
 * button is on the row rather than behind the detail page — the detail page
 * answers "who else is signed in on this account", which is the follow-up
 * question, and putting the action there would make the common case two clicks.
 *
 * The state filter defaults to the sessions that still work, because that is
 * what an operator opening this page is looking at. The expired ones are still
 * one filter away: an account with twenty dead sessions and one live one is
 * evidence of something, and hiding it behind "all" would bury it.
 */
export function SessionsContent() {
  const formats = useFormats()
  const t = useTranslations("Sessions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [term, setTerm] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [state, setState] = React.useState<"active" | "expired" | "all">(
    "active"
  )
  const [page, setPage] = React.useState(1)
  // The state and search the current page belongs to. Held separately because
  // typing is continuous and paging is not: page five of the previous results is
  // meaningless against a different result set, and correcting it in an effect
  // would paint the stale page once before fixing it.
  const [settled, setSettled] = React.useState<{
    state: "active" | "expired" | "all"
    search: string
  }>({ state: "active", search: "" })

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  if (state !== settled.state || search !== settled.search) {
    setSettled({ state, search })
    setPage(1)
  }

  const { data, isPending } = useQuery(
    trpc.sessions.list.queryOptions({
      search: search || undefined,
      state,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const sessions = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // The row a revoke is in flight for, so one row shows a spinner and the rest
  // stay clickable. A single boolean would grey out every row at once, which
  // reads as "the whole table is gone" during what is usually a one-click action.
  const [revokingId, setRevokingId] = React.useState<string | null>(null)

  const revoke = useMutation(
    trpc.sessions.revoke.mutationOptions({
      onMutate: ({ id }) => {
        setRevokingId(id)
      },
      onSuccess: (result, variables) => {
        setRevokingId(null)
        if (variables.allForUser) {
          toast.success(t("revokedAll", { count: result.revokedCount }))
        } else {
          toast.success(t("revoked"))
        }
        void queryClient.invalidateQueries({
          queryKey: trpc.sessions.list.queryKey(),
        })
        // The detail page shows the account's other sessions, so revoking from
        // the list leaves a stale set behind there too.
        void queryClient.invalidateQueries({
          queryKey: trpc.sessions.byId.queryKey({ id: variables.id }),
        })
      },
      onError: (error) => {
        setRevokingId(null)
        toast.error(t("revokeFailed"), { description: error.message })
      },
    })
  )

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
            value={state}
            aria-label={t("filterState")}
            onChange={(event) =>
              setState(event.target.value as "active" | "expired" | "all")
            }
          >
            <NativeSelectOption value="active">
              {t("state.active")}
            </NativeSelectOption>
            <NativeSelectOption value="expired">
              {t("state.expired")}
            </NativeSelectOption>
            <NativeSelectOption value="all">
              {t("state.all")}
            </NativeSelectOption>
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.account")}</TableHead>
                  <TableHead>{t("column.ip")}</TableHead>
                  <TableHead>{t("column.created")}</TableHead>
                  <TableHead>{t("column.expires")}</TableHead>
                  <TableHead>{t("column.state")}</TableHead>
                  <TableHead className="w-24">{t("column.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <LocaleLink
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/dashboard/sessions/${row.id}`}
                      >
                        {row.user.name ?? row.user.email ?? row.user.id}
                      </LocaleLink>
                      {row.user.email && row.user.name ? (
                        <span className="block max-w-80 truncate text-xs text-muted-foreground">
                          {row.user.email}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          row.expired
                            ? "border-muted-foreground/30 text-muted-foreground"
                            : "border-emerald-400/40 text-emerald-700 dark:text-emerald-300"
                        }
                      >
                        {row.expired ? t("expired") : t("active")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <RevokeDialog
                        expired={row.expired}
                        pending={revoke.isPending && revokingId === row.id}
                        onRevoke={(allForUser) =>
                          revoke.mutate({ id: row.id, allForUser })
                        }
                      />
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

/**
 * Revoking a session, behind a confirmation that names the cost.
 *
 * There is no undo, because the server cannot un-issue a token it has already
 * deleted the row for — the honest version of this control is one that says so
 * before it is used rather than after.
 *
 * Two buttons, because "end this one session" and "sign this account out
 * everywhere" are different requests with different consequences, and an
 * operator handling a compromised account almost always wants the second while
 * the first is the one that needs justifying. Collapsing them into one would
 * make the destructive-everywhere option the easy default.
 *
 * An expired session is not offered the action at all: revoking it changes
 * nothing the account can observe, and a control that always succeeds while doing
 * nothing is a control people click by reflex.
 */
function RevokeDialog({
  expired,
  pending,
  onRevoke,
}: {
  expired: boolean
  pending: boolean
  onRevoke: (allForUser: boolean) => void
}) {
  const t = useTranslations("Sessions")
  const common = useTranslations("Common")
  // Which of the two revokes the open dialog is asking to confirm. Reset when
  // the dialog closes so the next one starts on the narrower question, which is
  // the one an operator is most likely to have meant.
  const [scope, setScope] = React.useState<"one" | "all">("one")

  if (expired) {
    return (
      <span className="text-xs text-muted-foreground">{t("expired")}</span>
    )
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) setScope("one")
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive">
          {t("revoke")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          {/* Two confirmations rather than two buttons in one. "Sign out
              everywhere" ends every device this account is signed in on, so it
              gets its own dialog that says so, rather than sitting beside a
              confirm button as the easier-to-hit of the pair. */}
          {scope === "one" ? (
            <>
              <DialogTitle>{t("revokeTitle")}</DialogTitle>
              <DialogDescription>{t("revokeDescription")}</DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle>{t("revokeAllTitle")}</DialogTitle>
              <DialogDescription>
                {t("revokeAllDescription")}
              </DialogDescription>
            </>
          )}
        </DialogHeader>
        <DialogFooter>
          {/* Switching scope does not revoke anything: it re-asks the same
              dialog the broader question. That is what makes the broad action
              safe to offer here without it being the button an operator hits
              by accident. */}
          <DialogClose asChild>
            <Button variant="outline">{common("cancel")}</Button>
          </DialogClose>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              setScope(scope === "one" ? "all" : "one")
            }
          >
            {scope === "one" ? t("revokeAll") : t("revokeOneInstead")}
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              onRevoke(scope === "all")
            }}
          >
            {pending ? <Spinner /> : null}
            {scope === "one" ? t("revoke") : t("revokeAll")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}