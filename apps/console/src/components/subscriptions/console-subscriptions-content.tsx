/**
 * `/console/subscriptions` — 一个账号自己的订阅。
 *
 * 页面里没有一处权限判断，也不该有：`listMine` / `create` / `update` / `remove` /
 * `rotateSecret` / `sendTest` 全是 `protectedProcedure`，而归属过滤在服务层的 SQL 里按
 * `{ userId: session.user.id }` 发生（§6.7）。页面最容易漏检查，所以三处归属决定都不在
 * 这里。
 *
 * 一件刻意不做的事：**没有**"看别人的订阅"的入口，`subscriptions:write` 也不自助授予
 * （§2.5）。console 用户要 M2M 订阅就自己签一把 service key 走 `/api/v1/subscriptions`，
 * 两条路的归属主体不同，投递时的 `$owner` 也不同（§6.7 末尾那条注释说的就是这件事）。
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
import { IconPlayerPlay, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react"
import { SUBSCRIPTION_SCOPES } from "@/db/schema/subscriptions"
import {
  DetailButton,
  SubscriptionDetailDialog,
  SubscriptionsTable,
  type SubscriptionRow,
} from "@/components/subscriptions/subscriptions-table"
import { SubscriptionSecretDialog } from "@/components/subscriptions/subscription-secret-dialog"
import {
  EMPTY_FILTERS,
  SubscriptionFiltersForm,
  filtersToForm,
  filtersToInput,
  type SubscriptionFilterValue,
} from "@/components/subscriptions/subscription-filters-form"
import { useTRPC } from "@/lib/trpc/client"
import type { inferRouterInputs } from "@trpc/server"
import type { appRouter } from "@/lib/trpc/root"

/** 建订阅的表单形状，与 `subscriptionRequestSchema` 的必填项一一对应。 */
type CreateInput = inferRouterInputs<typeof appRouter>["subscriptions"]["create"]

export function ConsoleSubscriptionsContent() {
  const t = useTranslations("Subscriptions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [secret, setSecret] = React.useState<string | null>(null)
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
      onSuccess: (result) => {
        setSecret(result.secret)
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
    trpc.subscriptions.remove.mutationOptions({ onSuccess: () => void invalidate() })
  )
  const rotate = useMutation(
    trpc.subscriptions.rotateSecret.mutationOptions({
      onSuccess: (result) => {
        setSecret(result.secret)
        void invalidate()
      },
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
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreateSubscriptionDialog
            pending={create.isPending}
            error={create.error?.message ?? null}
            onCreate={(input) => create.mutate(input)}
          />

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
                <ConfirmButton
                  label={t("rotate")}
                  title={t("rotate")}
                  description={t("rotateConfirm")}
                  onConfirm={() => rotate.mutate({ id: row.id })}
                  disabled={rotate.isPending}
                  icon={<IconRefresh className="size-4" />}
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

      <SubscriptionSecretDialog
        secret={secret ?? ""}
        open={secret !== null}
        onAcknowledged={() => setSecret(null)}
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
  onCreate,
  pending,
  error,
}: {
  onCreate: (input: CreateInput) => void
  pending: boolean
  error: string | null
}) {
  const t = useTranslations("Subscriptions")
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [callbackUrl, setCallbackUrl] = React.useState("")
  const [cadence, setCadence] = React.useState<CreateInput["cadence"]>("daily")
  const [mode, setMode] = React.useState<CreateInput["mode"]>("batch")
  const [scopes, setScopes] = React.useState<CreateInput["scopes"]>([
    "repos.stats",
  ])
  const [filters, setFilters] = React.useState<SubscriptionFilterValue>(
    EMPTY_FILTERS
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // A failed submit keeps its input: the callback URL is long and the
        // cooldown-like friction of retyping it is the reason people give up.
        // Closing always clears it, so a half-filled form never reappears later.
        if (!next) setName("")
      }}
    >
      <Button type="button" disabled={pending} onClick={() => setOpen(true)}>
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
              disabled={pending || scopes.length === 0 || name.length === 0}
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
          <p className="text-xs text-muted-foreground">{t("editFiltersHint")}</p>
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