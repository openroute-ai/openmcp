/**
 * `/dashboard/subscriptions` — 管理员的订阅视图。
 *
 * 停用是这里唯一的动作，也是 §6.7 明确要求的那一个：一个用户可以把 `callbackUrl` 指向
 * 任意外部地址然后订全量数据，而用户不会主动取消。没有这一档，剩下的手段只有改全局
 * 密钥，那会连带打掉所有健康订阅。
 *
 * **除此之外这里什么都不改** —— 过滤器、`callbackUrl`、scopes 在这个页面不可写。那些是
 * 订阅方的意图：管理员替别人改过滤器，会让对方下次投递到的数据形状与他自己配的不一致，
 * 而这件事没有任何记录能解释。排障要读的那些东西（命中仓库数、水位线、投递历史、
 * `consecutiveFailures`、`lastError`）都在详情弹窗里，全部可读。
 *
 * 恢复也不在这里：订阅方自己在 `/console/subscriptions` 点"启用"。管理员替别人恢复，
 * 等于替他判断"现在应该开始给他发数据了"。
 */
"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
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
import { Label } from "@workspace/ui/components/label"
import { IconBan } from "@tabler/icons-react"
import {
  DetailButton,
  SubscriptionDetailDialog,
  SubscriptionsTable,
  type SubscriptionRow,
} from "@/components/subscriptions/subscriptions-table"
import { useTRPC } from "@/lib/trpc/client"

export function DashboardSubscriptionsContent() {
  const t = useTranslations("Subscriptions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [detailId, setDetailId] = React.useState<string | null>(null)

  const list = useQuery(
    trpc.subscriptions.list.queryOptions(undefined, {
      refetchOnWindowFocus: false,
    })
  )

  const detail = useQuery(
    trpc.subscriptions.detail.queryOptions(
      { id: detailId ?? "" },
      { enabled: detailId !== null }
    )
  )

  const disable = useMutation(
    trpc.subscriptions.disable.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.subscriptions.pathKey() }),
    })
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("adminTitle")}</CardTitle>
        <CardDescription>{t("adminDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {disable.error ? (
          <p className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {disable.error.message}
          </p>
        ) : null}

        <SubscriptionsTable
          rows={(list.data ?? []) as SubscriptionRow[]}
          pending={list.isPending}
          error={list.error?.message ?? null}
          renderActions={(row) => (
            <>
              <DetailButton onClick={() => setDetailId(row.id)} />
              {row.enabled ? (
                <DisableButton
                  disabled={disable.isPending}
                  onConfirm={(reason) => disable.mutate({ id: row.id, reason })}
                />
              ) : (
                <Badge variant="secondary" className="text-xs">
                  {row.disabledReason === "admin"
                    ? t("disabledByAdmin")
                    : row.disabledReason === "too_many_failures"
                      ? t("disabledByBreaker")
                      : t("paused")}
                </Badge>
              )}
            </>
          )}
        />
      </CardContent>

      <SubscriptionDetailDialog
        detail={detail.data ?? null}
        onClose={() => setDetailId(null)}
      />
    </Card>
  )
}

/**
 * 停用要一个理由，与 key 的 `revoke` 同一个理由（§2.13）：停用会立刻改变别人能收到什么，
 * 而"当时为什么停"三个月后仍然要能回答。理由只进 `api_request_audit` 与
 * `disabled_reason` 两处，没有别的消费者。
 */
function DisableButton({
  onConfirm,
  disabled,
}: {
  onConfirm: (reason: string) => void
  disabled: boolean
}) {
  const t = useTranslations("Subscriptions")
  const [reason, setReason] = React.useState("")

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disabled}
          className="text-destructive"
        >
          <IconBan className="size-4" />
          {t("disable")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("disable")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("disableConfirm")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="subscription-disable-reason">{t("reason")}</Label>
          <Input
            id="subscription-disable-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("reasonPlaceholder")}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{"cancel"}</AlertDialogCancel>
          <AlertDialogAction
            disabled={reason.trim().length === 0}
            onClick={() => onConfirm(reason.trim())}
          >
            {t("disable")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}