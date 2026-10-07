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
import { useFormats } from "@/lib/i18n/format"
import { formatFen } from "@/lib/billing/plans"
import { DataPagination } from "@/components/data-pagination"
import { LocaleLink } from "@/i18n/navigation"

/** Rows per page. A ledger is scanned for one line, not read end to end. */
const PAGE_SIZE = 20

/** How long typing pauses before the search is sent (a round trip per prefix). */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The channels an order can carry.
 *
 * `subscriptionOrders.channel` is free text with a default, so its schema type
 * is `string`; this is the set the writer ever emits. The narrowed cast keeps
 * `t` checked against the message keys without widening every channel to raw.
 */
type KnownChannel = "wechat"

/** The account half of a row. Both tables name the payer through the user. */
function AccountCell({
  userId,
  name,
  email,
}: {
  userId: string
  name: string | null
  email: string | null
}) {
  return (
    <>
      <LocaleLink
        className="font-medium underline-offset-4 hover:underline"
        href={`/dashboard/users/${userId}`}
      >
        {name ?? email ?? userId}
      </LocaleLink>
      {email && name ? (
        <span className="block max-w-80 truncate text-xs text-muted-foreground">
          {email}
        </span>
      ) : null}
    </>
  )
}

/** A short identifier kept whole, so an operator can match it by eye. */
function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {children}
    </span>
  )
}

/** A filter/search bar, shared because both tables page the same way. */
function useSettledSearch() {
  const [term, setTerm] = React.useState("")
  const [search, setSearch] = React.useState("")

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  return { term, setTerm, search }
}

/**
 * Who is paying: `user_subscriptions`, as the operator sees it.
 *
 * Entitlement has no middle state — `activeUntil` against the server's clock
 * is the whole of it — so the badge and the filter say the same thing, and the
 * query already dropped the rows the filter excluded rather than colouring
 * them after. Rows are ordered by expiry, not by creation: the operator wants
 * the entitlements running out next on top.
 */
function SubscriptionsCard() {
  const formats = useFormats()
  const t = useTranslations("Billing")
  const trpc = useTRPC()
  const { term, setTerm, search } = useSettledSearch()
  const [state, setState] = React.useState<"all" | "active" | "expired">(
    "all"
  )
  const [page, setPage] = React.useState(1)
  const [settled, setSettled] = React.useState<{
    state: "all" | "active" | "expired"
    search: string
  }>({ state: "all", search: "" })

  if (state !== settled.state || search !== settled.search) {
    setSettled({ state, search })
    setPage(1)
  }

  const { data, isPending } = useQuery(
    trpc.billing.listSubscriptions.queryOptions({
      search: search || undefined,
      state,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Card>
      <CardHeader>
        <div className="grid gap-1">
          <CardTitle>{t("subscriptionsTitle")}</CardTitle>
          <CardDescription>{t("subscriptionsDescription")}</CardDescription>
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
              setState(event.target.value as "all" | "active" | "expired")
            }
          >
            <NativeSelectOption value="all">{t("stateAll")}</NativeSelectOption>
            <NativeSelectOption value="active">
              {t("state.active")}
            </NativeSelectOption>
            <NativeSelectOption value="expired">
              {t("state.expired")}
            </NativeSelectOption>
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("emptySubscriptions")}
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.user")}</TableHead>
                  <TableHead>{t("column.plan")}</TableHead>
                  <TableHead>{t("column.state")}</TableHead>
                  <TableHead>{t("column.until")}</TableHead>
                  <TableHead>{t("column.sourceOrder")}</TableHead>
                  <TableHead>{t("column.updated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell>
                      <AccountCell
                        userId={row.userId}
                        name={row.userName}
                        email={row.userEmail}
                      />
                    </TableCell>
                    <TableCell>{t(`plan.${row.plan}`)}</TableCell>
                    <TableCell>
                      {row.active ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-400/40 text-emerald-700 dark:text-emerald-300"
                        >
                          {t("state.active")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{t("state.expired")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.dateTime(row.activeUntil)}
                    </TableCell>
                    <TableCell>
                      <Mono>{row.sourceOrderId}</Mono>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.updatedAt)}
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
 * The money ledger: `subscription_orders`, as the operator sees it.
 *
 * A line here is money itself — order id, amount, channel, the callback's
 * verdict — so this table is the record, not a summary; whoever reconciles
 * against it works off the rows. Newest first, because a dispute starts at
 * today's rows.
 */
function OrdersCard() {
  const formats = useFormats()
  const t = useTranslations("Billing")
  const trpc = useTRPC()
  const { term, setTerm, search } = useSettledSearch()
  const [status, setStatus] = React.useState<
    "all" | "pending" | "paid" | "expired" | "closed"
  >("all")
  const [page, setPage] = React.useState(1)
  const [settled, setSettled] = React.useState<{
    status: "all" | "pending" | "paid" | "expired" | "closed"
    search: string
  }>({ status: "all", search: "" })

  if (status !== settled.status || search !== settled.search) {
    setSettled({ status, search })
    setPage(1)
  }

  const { data, isPending } = useQuery(
    trpc.billing.listOrders.queryOptions({
      search: search || undefined,
      status,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Card>
      <CardHeader>
        <div className="grid gap-1">
          <CardTitle>{t("ordersTitle")}</CardTitle>
          <CardDescription>{t("ordersDescription")}</CardDescription>
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
            value={status}
            aria-label={t("filterStatus")}
            onChange={(event) =>
              setStatus(
                event.target.value as
                  | "all"
                  | "pending"
                  | "paid"
                  | "expired"
                  | "closed"
              )
            }
          >
            <NativeSelectOption value="all">{t("statusAll")}</NativeSelectOption>
            <NativeSelectOption value="pending">
              {t("status.pending")}
            </NativeSelectOption>
            <NativeSelectOption value="paid">
              {t("status.paid")}
            </NativeSelectOption>
            <NativeSelectOption value="expired">
              {t("status.expired")}
            </NativeSelectOption>
            <NativeSelectOption value="closed">
              {t("status.closed")}
            </NativeSelectOption>
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyOrders")}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.orderId")}</TableHead>
                  <TableHead>{t("column.user")}</TableHead>
                  <TableHead>{t("column.plan")}</TableHead>
                  <TableHead className="text-right">{t("column.amount")}</TableHead>
                  <TableHead>{t("column.channel")}</TableHead>
                  <TableHead>{t("column.status")}</TableHead>
                  <TableHead>{t("column.created")}</TableHead>
                  <TableHead>{t("column.paidAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Mono>{row.id}</Mono>
                    </TableCell>
                    <TableCell>
                      <AccountCell
                        userId={row.userId}
                        name={row.userName}
                        email={row.userEmail}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {t(`plan.${row.plan}`)} · {t(`cycle.${row.cycle}`)}
                        {row.renewal ? (
                          <Badge variant="outline">{t("renewalBadge")}</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatFen(row.amountFen)}
                    </TableCell>
                    <TableCell>
                      {t(`channel.${row.channel as KnownChannel}`)}
                    </TableCell>
                    <TableCell>
                      {row.status === "paid" ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-400/40 text-emerald-700 dark:text-emerald-300"
                        >
                          {t(`status.${row.status}`)}
                        </Badge>
                      ) : row.status === "pending" ? (
                        <Badge
                          variant="outline"
                          className="border-amber-400/40 text-amber-700 dark:text-amber-300"
                        >
                          {t(`status.${row.status}`)}
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          {t(`status.${row.status}`)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.dateTime(row.paidAt)}
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
 * 运营控制台的结算页：上面"谁在付费"，下面"付的结果"。
 *
 * 两张表一份账。子查询各自分页、各自筛选，互不打扰；把它们放在同一页（而不是
 * 两个页面）是为了让"谁付了"和"付的结果"能并排对——运营查资费投诉时，这两段
 * 是同一个问题的两面。
 */
export function DashboardBillingContent() {
  return (
    <div className="grid gap-6">
      <SubscriptionsCard />
      <OrdersCard />
    </div>
  )
}