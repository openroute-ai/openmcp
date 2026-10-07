/**
 * `/console/subscriptions` — 一个账号自己的订阅。
 *
 * 页面里没有一处权限判断，也不该有：`listMine` / `create` / `update` / `remove` /
 * `sendTest` 全是 `protectedProcedure`，而归属过滤在服务层的 SQL 里按
 * `{ userId: session.user.id }` 发生（§6.7）。页面最容易漏检查，所以归属决定都不在这里。
 *
 * 建订阅时表单里要挑一把**自己的** api key：验签密钥由它的 `key_hash` 派生，这是这条
 * 入口与 `/api/v1/subscriptions` 的唯一差别（v1 那条的 key 来自鉴权主体，不需要挑）。
 * 两条路写进 `subscriptions` 的形状因此是一样的，投递时的 `$owner` 也一样（§6.7）。
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
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { IconPlayerPlay, IconPlus, IconTrash } from "@tabler/icons-react"
import { SUBSCRIPTION_SCOPES } from "@/db/schema/subscriptions"
import {
  DetailButton,
  SubscriptionDetailDialog,
  SubscriptionsTable,
  type SubscriptionRow,
} from "@/components/subscriptions/subscriptions-table"
import { SubscriptionCreatedDialog } from "@/components/subscriptions/subscription-created-dialog"
import {
  EMPTY_FILTERS,
  SubscriptionFiltersForm,
  filtersToForm,
  filtersToInput,
  type SubscriptionFilterValue,
} from "@/components/subscriptions/subscription-filters-form"
import { useTRPC } from "@/lib/trpc/client"
import { ERROR_CODES } from "@/lib/trpc/error-codes"
import { CheckoutButton } from "@/components/billing/checkout-launcher"
import type { inferRouterInputs } from "@trpc/server"
import type { appRouter } from "@/lib/trpc/root"

/** 建订阅的表单形状，与 `subscriptionRequestSchema` 的必填项一一对应。 */
type CreateInput = inferRouterInputs<
  typeof appRouter
>["subscriptions"]["create"]

export function ConsoleSubscriptionsContent() {
  const t = useTranslations("Subscriptions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  // 付费闸：推送订阅是 Pro 专享（§6.7 之后的决定）。没有生效订阅就看不到「新建」
  // 按钮——服务端 `subscriptions.create` 也会拦，这一层只是把付费墙表达给用户。
  const entitlement = useQuery(trpc.billing.getMySubscription.queryOptions())

  // 建订阅的弹窗归这一层管，因为确认弹窗关掉时要连它一起关：两层叠着，读者会以为
  // 刚才那次提交没成功，而下一次要建还得先把上面那层点掉。
  const [createOpen, setCreateOpen] = React.useState(false)
  const [created, setCreated] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<SubscriptionRow | null>(null)
  const [testResult, setTestResult] = React.useState<string | null>(null)

  // `refetchOnWindowFocus: false` for the same reason as `/console/api-keys`: a
  // background refetch replaces the row the reader is about to click "delete" on,
  // and this list is short enough that a manual refresh costs nothing.
  const list = useQuery(
    trpc.subscriptions.listMine.queryOptions(undefined, {
      refetchOnWindowFocus: false,
    })
  )

  const detail = useQuery(
    trpc.subscriptions.detail.queryOptions(
      { id: detailId ?? "" },
      { enabled: detailId !== null }
    )
  )

  // Scoped to this router rather than a blanket invalidation: the detail dialog
  // and the list both read subscriptions, and nothing else on the page does.
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.subscriptions.pathKey() })

  const create = useMutation(
    trpc.subscriptions.create.mutationOptions({
      onSuccess: () => {
        setCreated(true)
        void invalidate()
      },
    })
  )
  const update = useMutation(
    trpc.subscriptions.update.mutationOptions({
      onSuccess: () => {
        setEditing(null)
        void invalidate()
      },
    })
  )
  const remove = useMutation(
    trpc.subscriptions.remove.mutationOptions({
      onSuccess: () => void invalidate(),
    })
  )
  const sendTest = useMutation(
    trpc.subscriptions.sendTest.mutationOptions({
      onSuccess: (result) => {
        setTestResult(
          result.delivered
            ? t("testDelivered", { http: result.httpStatus ?? 0 })
            : t("testFailed", { error: result.error ?? t("unknownError") })
        )
        void invalidate()
      },
      onError: (error) => setTestResult(error.message),
    })
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          {/* 标题与「新建订阅」按钮同一行：标题居左，按钮居右；窄屏时换行、
             按钮落到标题下方，而不是把按钮挤到看不见。 */}
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 basis-72">
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </div>
            {/* 付费闸：未付费连按钮都不给，服务端 `create` 才是真闸。 */}
            {entitlement.data ? (
              <CreateSubscriptionDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                pending={create.isPending}
                error={
                  create.error &&
                  create.error.data?.appCode === ERROR_CODES.paidPlanRequired
                    ? t("paidRequiredError")
                    : (create.error?.message ?? null)
                }
                onCreate={(input) => create.mutate(input)}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {entitlement.data === null ? <PaidGateway /> : null}

          {testResult ? (
            <p className="rounded-md border bg-muted px-3 py-2 text-sm">
              {testResult}
            </p>
          ) : null}

          <SubscriptionsTable
            rows={list.data ?? []}
            pending={list.isPending}
            error={list.error?.message ?? null}
            renderActions={(row) => (
              <>
                <DetailButton onClick={() => setDetailId(row.id)} />
                <ConfirmButton
                  label={t("sendTest")}
                  title={t("sendTest")}
                  description={t("sendTestConfirm")}
                  onConfirm={() => sendTest.mutate({ id: row.id })}
                  disabled={sendTest.isPending || remove.isPending}
                  icon={<IconPlayerPlay className="size-4" />}
                />
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setEditing(row)}
                >
                  {t("edit")}
                </Button>
                <ConfirmButton
                  label={t("remove")}
                  title={t("remove")}
                  description={t("removeConfirm")}
                  onConfirm={() => remove.mutate({ id: row.id })}
                  disabled={remove.isPending}
                  destructive
                  icon={<IconTrash className="size-4" />}
                />
              </>
            )}
          />
        </CardContent>
      </Card>

      <SubscriptionDetailDialog
        detail={detail.data ?? null}
        onClose={() => setDetailId(null)}
      />

      <EditSubscriptionDialog
        row={editing}
        pending={update.isPending}
        error={update.error?.message ?? null}
        onClose={() => setEditing(null)}
        onSave={(patch) => update.mutate({ id: editing!.id, ...patch })}
      />

      <SubscriptionCreatedDialog
        open={created}
        onAcknowledged={() => {
          setCreated(false)
          setCreateOpen(false)
        }}
      />
    </div>
  )
}

function ScopePicker({
  value,
  onChange,
}: {
  value: CreateInput["scopes"]
  onChange: (next: CreateInput["scopes"]) => void
}) {
  const t = useTranslations("Subscriptions")
  const id = React.useId()

  return (
    <div className="flex flex-wrap gap-3">
      {SUBSCRIPTION_SCOPES.map((scope) => {
        const inputId = `${id}-${scope}`
        return (
          <div key={scope} className="flex items-center gap-1.5">
            <input
              id={inputId}
              type="checkbox"
              className="size-4 accent-primary"
              checked={value.includes(scope)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, scope]
                    : value.filter((item) => item !== scope)
                )
              }
            />
            <Label htmlFor={inputId} className="font-mono text-xs font-normal">
              {scope}
            </Label>
          </div>
        )
      })}
      <p className="w-full text-xs text-muted-foreground">{t("scopesHint")}</p>
    </div>
  )
}

function CreateSubscriptionDialog({
  open,
  onOpenChange,
  onCreate,
  pending,
  error,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  onCreate: (input: CreateInput) => void
  pending: boolean
  error: string | null
}) {
  const t = useTranslations("Subscriptions")
  const trpc = useTRPC()
  const [name, setName] = React.useState("")
  const [callbackUrl, setCallbackUrl] = React.useState("")
  const [cadence, setCadence] = React.useState<CreateInput["cadence"]>("daily")
  const [mode, setMode] = React.useState<CreateInput["mode"]>("batch")
  const [scopes, setScopes] = React.useState<CreateInput["scopes"]>([
    "repos.stats",
  ])
  const [filters, setFilters] =
    React.useState<SubscriptionFilterValue>(EMPTY_FILTERS)
  const [apiKeyId, setApiKeyId] = React.useState("")

  const keys = useQuery(trpc.apiKeys.listMine.queryOptions())
  const activeKeys = React.useMemo(
    () => (keys.data ?? []).filter((row) => row.revokedAt === null),
    [keys.data]
  )
  // 吊销的 key 不进候选，所以下面这行只在「已选的那把被吊销了」时才会换人。
  // 重算放在渲染期而不是 effect 里：effect 会让 select 先闪一帧空值。
  const selectedKeyId = activeKeys.some((row) => row.id === apiKeyId)
    ? apiKeyId
    : (activeKeys[0]?.id ?? "")

  // A failed submit keeps its input: the callback URL is long and the
  // cooldown-like friction of retyping it is the reason people give up.
  // Clearing the name on *open* rather than on close keeps one rule for every
  // closing path — the reader's own gesture and the acknowledgement dialog
  // both collapse into "the next open starts a fresh form".
  function openCreate() {
    setName("")
    onOpenChange(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button type="button" disabled={pending} onClick={openCreate}>
        <IconPlus className="size-4" />
        {t("newSubscription")}
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("newSubscription")}</DialogTitle>
          <DialogDescription>{t("formDescription")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            onCreate({
              name,
              callbackUrl,
              cadence,
              mode,
              scopes,
              apiKeyId: selectedKeyId,
              filters: filtersToInput(filters),
            })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="subscription-name">{t("name")}</Label>
            <Input
              id="subscription-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
              required
              maxLength={120}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="subscription-callback">{t("callbackUrl")}</Label>
            <Input
              id="subscription-callback"
              type="url"
              value={callbackUrl}
              onChange={(event) => setCallbackUrl(event.target.value)}
              placeholder="https://example.com/hooks/radar"
              required
            />
            <p className="text-xs text-muted-foreground">
              {t("callbackUrlHint")}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="subscription-cadence">{t("cadence")}</Label>
              <select
                id="subscription-cadence"
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={cadence}
                onChange={(event) =>
                  setCadence(event.target.value as CreateInput["cadence"])
                }
              >
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="subscription-mode">{t("mode")}</Label>
              <select
                id="subscription-mode"
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as CreateInput["mode"])
                }
              >
                <option value="batch">batch</option>
                <option value="snapshot">snapshot</option>
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="subscription-api-key">{t("signingKeyLabel")}</Label>
            {activeKeys.length > 0 ? (
              <select
                id="subscription-api-key"
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={selectedKeyId}
                onChange={(event) => setApiKeyId(event.target.value)}
              >
                {activeKeys.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {row.prefix}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-md border bg-muted px-3 py-2 text-sm">
                {keys.isPending ? "…" : t("signingKeyEmpty")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("signingKeyHint")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label>{t("scopes")}</Label>
            <ScopePicker value={scopes} onChange={setScopes} />
          </div>

          <div className="grid gap-2">
            <Label>{t("filters")}</Label>
            <SubscriptionFiltersForm value={filters} onChange={setFilters} />
          </div>

          {error ? <ErrorNote message={error} /> : null}

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                pending ||
                scopes.length === 0 ||
                name.length === 0 ||
                selectedKeyId === ""
              }
            >
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 改订阅。只暴露 `name` / `callbackUrl` / `filters` 三样，因为它们是订阅方想改的那三样，
 * 而 `scopes`、`mode`、`expiresAt` 各自有独立的理由（换形态会让水位线失去意义），它们在
 * REST 上仍然是 `PATCH` 能改的字段。
 */
function EditSubscriptionDialog({
  row,
  onSave,
  onClose,
  pending,
  error,
}: {
  row: SubscriptionRow | null
  onSave: (patch: {
    name?: string
    callbackUrl?: string
    filters?: ReturnType<typeof filtersToInput>
  }) => void
  onClose: () => void
  pending: boolean
  error: string | null
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {/* Keyed on the id so the form starts from the row being edited in one
            pass. An effect resetting three pieces of state would cost an extra
            render and leave the *previous* row's values on screen for a frame —
            which, for a callback URL, is a filter about to be saved onto the wrong
            subscription. */}
        {row ? (
          <EditForm
            key={row.id}
            row={row}
            onSave={onSave}
            pending={pending}
            error={error}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  row,
  onSave,
  pending,
  error,
}: {
  row: SubscriptionRow
  onSave: (patch: {
    name?: string
    callbackUrl?: string
    filters?: ReturnType<typeof filtersToInput>
  }) => void
  pending: boolean
  error: string | null
}) {
  const t = useTranslations("Subscriptions")
  const [name, setName] = React.useState(row.name)
  const [callbackUrl, setCallbackUrl] = React.useState(row.callbackUrl)
  const [filters, setFilters] = React.useState<SubscriptionFilterValue>(() =>
    filtersToForm(row.filters)
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("edit")}</DialogTitle>
        <DialogDescription>{t("editDescription")}</DialogDescription>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSave({
            name,
            callbackUrl,
            filters: filtersToInput(filters),
          })
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="edit-subscription-name">{t("name")}</Label>
          <Input
            id="edit-subscription-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="edit-subscription-callback">{t("callbackUrl")}</Label>
          <Input
            id="edit-subscription-callback"
            type="url"
            value={callbackUrl}
            onChange={(event) => setCallbackUrl(event.target.value)}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label>{t("filters")}</Label>
          <SubscriptionFiltersForm value={filters} onChange={setFilters} />
          <p className="text-xs text-muted-foreground">
            {t("editFiltersHint")}
          </p>
        </div>

        {error ? <ErrorNote message={error} /> : null}

        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function ConfirmButton({
  label,
  title,
  description,
  onConfirm,
  disabled,
  destructive,
  icon,
}: {
  label: string
  title: string
  description: string
  onConfirm: () => void
  disabled?: boolean
  destructive?: boolean
  icon?: React.ReactNode
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disabled}
          className={destructive ? "text-destructive" : undefined}
        >
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{"cancel"}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{title}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}

/**
 * 未付费时的建订阅入口替代物。
 *
 * 直接在订阅页里开结账弹窗，而不是把用户踢到落地页再找回来：弹窗就是落地页那一个
 * （`checkout-dialog.tsx`），选月付/年付、扫码、轮询确认的流程完全一致。支付成功后
 * 弹窗会 invalidate `billing.getMySubscription`，这里查到权益后立即换成「新建订阅」。
 */
function PaidGateway() {
  const t = useTranslations("Subscriptions")

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted px-4 py-3">
      <div className="grid gap-0.5">
        <p className="text-sm font-medium">{t("paidGateTitle")}</p>
        <p className="text-sm text-muted-foreground">
          {t("paidGateDescription")}
        </p>
      </div>
      {/* 支付成功「进入控制台」就回到这一页：权益刚开通，入口要立刻能建订阅。 */}
      <CheckoutButton size="sm" returnPath="/console/subscriptions">
        {t("paidGateCta")}
      </CheckoutButton>
    </div>
  )
}
