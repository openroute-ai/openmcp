"use client"

/**
 * `/console/billing` — 普通用户自己的账单：我的订阅 + 支付历史。
 *
 * 与运营侧的 `/dashboard/billing`（`listSubscriptions` / `listOrders`，全表）相对：
 * 这里只回答"我自己的"——订阅详情读 `getMySubscription`（过期即不存在），付款历史读
 * `myOrders`（`user_id = session.user.id` 写在 SQL 里，不是取回来再比）。续费的判定
 * 在服务端建单那一刻发生，本页只是把"生效期内 → 给续费按钮"这个状态表达出来。
 */
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
import { CheckoutButton } from "@/components/billing/checkout-launcher"
import { DataPagination } from "@/components/data-pagination"

/** Rows per page. A ledger is scanned for one line, not read end to end. */
const PAGE_SIZE = 20

/** The channel the writer ever emits; mirrored from the dedicated cast. */
type KnownChannel = "wechat"

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs text-muted-foreground">{children}</span>
  )
}

export function ConsoleBillingContent() {
  const t = useTranslations("Billing")
  const formats = useFormats()
  const trpc = useTRPC()

  const subscription = useQuery(
    trpc.billing.getMySubscription.queryOptions()
  )

  const [status, setStatus] = React.useState<
    "all" | "pending" | "paid" | "expired" | "closed"
  >("all")
  const [page, setPage] = React.useState(1)
  const [settled, setSettled] = React.useState<{
    status: "all" | "pending" | "paid" | "expired" | "closed"
  }>({ status: "all" })

  if (status !== settled.status) {
    setSettled({ status })
    setPage(1)
  }

  const orders = useQuery(
    trpc.billing.myOrders.queryOptions({
      status,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const rows = orders.data?.items ?? []
  const total = orders.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("mySubscriptionTitle")}</CardTitle>
          <CardDescription>{t("mySubscriptionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {subscription.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : subscription.data ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="grid gap-1">
                <p className="font-display text-xl font-semibold">
                  {t(`plan.${subscription.data.plan}`)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("untilPrefix")} {formats.dateTime(subscription.data.activeUntil)}
                </p>
                <p className="text-xs text-muted-foreground">{t("renewNote")}</p>
              </div>
              <CheckoutButton renewal returnPath="/console/billing">
                {t("renew")}
              </CheckoutButton>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="grid gap-1">
                <p className="text-sm font-medium">{t("notSubscribedTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("notSubscribedDescription")}
                </p>
              </div>
              <CheckoutButton returnPath="/console/billing">
                {t("openPro")}
              </CheckoutButton>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("historyTitle")}</CardTitle>
            <CardDescription>{t("historyDescription")}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
          {orders.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptyOrders")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("column.orderId")}</TableHead>
                    <TableHead>{t("column.plan")}</TableHead>
                    <TableHead className="text-right">
                      {t("column.amount")}
                    </TableHead>
                    <TableHead>{t("column.channel")}</TableHead>
                    <TableHead>{t("column.status")}</TableHead>
                    <TableHead>{t("column.paidAt")}</TableHead>
                    <TableHead>{t("column.created")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Mono>{row.id}</Mono>
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
                        {formats.dateTime(row.paidAt ?? row.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formats.dateTime(row.createdAt)}
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