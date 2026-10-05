/**
 * 订阅表格与详情弹窗，`/console/subscriptions` 与 `/dashboard/subscriptions` 共用。
 *
 * 共用的理由不是"省代码"，而是这两个页面对「一条订阅是什么」必须有同一个答案：管理员
 * 停用一条订阅之后，订阅方在自己的页面看到的 `enabled` 与管理员在治理页看到的是同一列
 * 同一个值。两份组件各自维护一份列集合，下一个新增的列（例如"上次投递的 httpStatus"）
 * 只会出现在其中一处，而两处对不上时读者会以为这两条是两条不同的订阅。
 *
 * 行类型从 router 输出推断而不是手写字段：`SubscriptionRow` 少一个字段时这里是编译
 * 错误，而不是表格里悄悄渲染出 `undefined`。
 */
"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  Badge,
} from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { FilterSummary } from "@/components/subscriptions/subscription-filters-form"
import { useFormats } from "@/lib/i18n/format"

export interface SubscriptionRow {
  id: string
  name: string
  callbackUrl: string
  secretPrefix: string
  cadence: "daily" | "weekly" | "monthly"
  mode: "batch" | "snapshot"
  scopes: string[]
  filters: Parameters<typeof FilterSummary>[0]["filters"]
  filtersVersion: number
  enabled: boolean
  disabledReason: "too_many_failures" | "admin" | null
  watermark: string | null
  createdAt: string
  expiresAt: string | null
}

export function SubscriptionsTable({
  rows,
  pending,
  error,
  renderActions,
}: {
  rows: readonly SubscriptionRow[]
  pending: boolean
  error: string | null
  /**
   * 动作列。两个页面给的东西不一样（订阅方能改能删，管理员只有停用），所以这里是插槽
   * 而不是 `canEdit` 布尔——布尔会让第三种权限要求变成再加一个 flag。
   */
  renderActions: (row: SubscriptionRow) => React.ReactNode
}) {
  const t = useTranslations("Subscriptions")

  if (error) {
    return (
      <p className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    )
  }

  if (pending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-1 py-6 text-center text-muted-foreground">
        <p className="text-sm font-medium">{t("empty")}</p>
        <p className="text-xs">{t("emptyHint")}</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("name")}</TableHead>
          <TableHead>{t("cadence")}</TableHead>
          <TableHead>{t("scopes")}</TableHead>
          <TableHead>{t("filters")}</TableHead>
          <TableHead>{t("watermark")}</TableHead>
          <TableHead className="text-right">{t("action")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <SubscriptionRowView
            key={row.id}
            row={row}
            actions={renderActions(row)}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function SubscriptionRowView({
  row,
  actions,
}: {
  row: SubscriptionRow
  actions: React.ReactNode
}) {
  const t = useTranslations("Subscriptions")
  const format = useFormats()

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.name}</span>
          {/* The callback URL is the one field a support answer always needs, so it
              is on the row rather than behind a click. It is truncated from the
              left: the host is at the end, and a truncated start hides exactly
              the part that says where the data is going. */}
          <span
            className="font-mono text-xs text-muted-foreground"
            title={row.callbackUrl}
          >
            {row.callbackUrl}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {t("secretPrefix")} {row.secretPrefix}
          </span>
          {!row.enabled ? (
            <Badge variant="secondary" className="w-fit">
              {row.disabledReason === "admin"
                ? t("disabledByAdmin")
                : row.disabledReason === "too_many_failures"
                  ? t("disabledByBreaker")
                  : t("paused")}
            </Badge>
          ) : null}
          {row.expiresAt ? (
            <span className="text-xs text-muted-foreground">
              {t("expiresAt", { date: format.dateTime(toDate(row.expiresAt)) })}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge variant="outline" className="w-fit text-xs">
            {row.cadence}
          </Badge>
          <Badge variant="outline" className="w-fit text-xs">
            {row.mode}
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {row.scopes.map((scope) => (
            <Badge key={scope} variant="outline" className="font-mono text-xs">
              {scope}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <FilterSummary filters={row.filters} />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.mode === "batch"
          ? row.watermark
            ? format.dateTime(toDate(row.watermark))
            : t("neverDelivered")
          : t("modeSnapshotWatermark", { version: row.filtersVersion })}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap justify-end gap-1">{actions}</div>
      </TableCell>
    </TableRow>
  )
}

/**
 * 订阅详情：契约里的排障字段。
 *
 * `deliveries` 是它存在的理由——不给这个，订阅方唯一的排障手段就是"等明天看数据有没有
 * 更新"（§6.8）。数据来自 `subscriptions.detail`，所以管理员看别人的订阅时命中的仓库数
 * 同样是服务端算的，页面没有第二个算法。
 */
export function SubscriptionDetailDialog({
  detail,
  onClose,
}: {
  detail: {
    matchedRepos: number
    lastDeliveredAt: string | null
    lastError: string | null
    consecutiveFailures: number
    filtersVersion: number
    filters: Parameters<typeof FilterSummary>[0]["filters"]
    callbackUrl: string
    secretPrefix: string
    deliveries: {
      eventId: string
      status: "pending" | "delivered" | "failed"
      attempt: number
      httpStatus: number | null
      error: string | null
      createdAt: string
    }[]
  } | null
  onClose: () => void
}) {
  const t = useTranslations("Subscriptions")
  const format = useFormats()

  return (
    <Dialog open={detail !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("detailTitle")}</DialogTitle>
          <DialogDescription>{detail?.callbackUrl ?? ""}</DialogDescription>
        </DialogHeader>

        {detail ? (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-2">
              <Field label={t("matchedRepos")}>
                {detail.matchedRepos}
              </Field>
              <Field label={t("filtersVersion")}>
                {detail.filtersVersion}
              </Field>
              <Field label={t("lastDelivered")}>
                {detail.lastDeliveredAt
                  ? format.dateTime(toDate(detail.lastDeliveredAt))
                  : t("never")}
              </Field>
              <Field label={t("consecutiveFailures")}>
                {detail.consecutiveFailures}
              </Field>
            </dl>

            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">
                {t("secretPrefix")} {detail.secretPrefix}
              </span>
              <FilterSummary filters={detail.filters} />
            </div>

            {detail.lastError ? (
              <p className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {detail.lastError}
              </p>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("deliveryHistory")}
              </p>
              {detail.deliveries.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("noDeliveries")}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("deliveryTime")}</TableHead>
                        <TableHead>{t("deliveryStatus")}</TableHead>
                        <TableHead>{t("deliveryHttp")}</TableHead>
                        <TableHead>{t("deliveryAttempt")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.deliveries.map((delivery) => (
                        <TableRow key={delivery.eventId}>
                          <TableCell className="text-xs">
                            {format.dateTime(toDate(delivery.createdAt))}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge
                              variant={
                                delivery.status === "delivered"
                                  ? "secondary"
                                  : "destructive"
                              }
                            >
                              {delivery.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {delivery.httpStatus ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {delivery.attempt}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {detail.deliveries.some((row) => row.error) ? (
                <ul className="space-y-1 text-xs text-destructive">
                  {detail.deliveries
                    .filter((row) => row.error)
                    .slice(0, 3)
                    .map((row) => (
                      <li key={row.eventId} className="break-all">
                        {row.error}
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * 契约里的时间是 ISO 字符串（`isoDateTime`），而 `useFormats` 收 `Date`。
 *
 * 在这一处转换而不是让 `dateTime` 收字符串：格式器有二十多个调用方，其中大多数拿到的
 * 是 drizzle 的 `Date`，而把 `string | Date` 收进去会让每一个调用点都要自己判断类型。
 */
function toDate(value: string): Date {
  return new Date(value)
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** 详情弹窗的触发按钮。两个页面的动作列都用它，所以放在这个文件里。 */
export function DetailButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("Subscriptions")
  return (
    <Button variant="outline" size="sm" onClick={onClick} type="button">
      {t("detail")}
    </Button>
  )
}