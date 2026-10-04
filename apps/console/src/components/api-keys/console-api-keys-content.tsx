/**
 * `/console/api-keys` — an account's own keys.
 *
 * Every mutation here is `protectedProcedure`, so the page is reachable by any
 * signed-in account. What makes it safe is not this file: it is
 * `createMine`'s input schema, which has no `userId` / `tier` / rate-limit
 * fields at all, and `assertKeyBelongsTo` in the service layer, which refuses a
 * `keyId` belonging to somebody else. A page is the easiest place to forget a
 * check, so none of the three ownership decisions are made here.
 *
 * Two things are deliberately absent. There is no way to grant a scope beyond
 * {@link SELF_SERVICE_SCOPES} — the picker only offers those, and the router
 * rejects anything else — and there is no way to delete: `revoke` keeps the row
 * so the audit log has something to point at, and a key that can be scrubbed is a
 * key whose revocation cannot be proven.
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { IconPlus, IconRefresh } from "@tabler/icons-react"
import { ApiKeyScopePicker } from "@/components/api-keys/api-key-scope-picker"
import { ApiKeySecretDialog } from "@/components/api-keys/api-key-secret-dialog"
import { useTRPC } from "@/lib/trpc/client"
import type { inferRouterOutputs } from "@trpc/server"
import type { appRouter } from "@/lib/trpc/root"
import { useFormats } from "@/lib/i18n/format"
import { SELF_SERVICE_SCOPES, type SelfServiceScope } from "@/lib/api/scopes"

export function ConsoleApiKeysContent() {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [secret, setSecret] = React.useState<string | null>(null)

  // `refetchOnWindowFocus: false` because a background refetch silently replaces
  // the row the reader is about to click "revoke" on, and this list is small
  // enough that a manual refresh costs nothing.
  const keys = useQuery(
    trpc.apiKeys.listMine.queryOptions(undefined, {
      refetchOnWindowFocus: false,
    })
  )

  // Scoped to the `apiKeys` subtree rather than `invalidateQueries()` with no
  // argument: a blanket invalidation refetches every mounted query on the page,
  // and this page has no other data to refetch.
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.apiKeys.pathKey() })

  const revoke = useMutation(
    trpc.apiKeys.revokeMine.mutationOptions({
      onSuccess: () => void invalidate(),
    })
  )
  const rotate = useMutation(
    trpc.apiKeys.rotateMine.mutationOptions({
      onSuccess: (result) => {
        setSecret(result.issued.secret)
        void invalidate()
      },
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
          <CreateKeyDialog onIssued={(value) => setSecret(value)} />
          {revoke.error ? <ErrorNote message={revoke.error.message} /> : null}
          {rotate.error ? <ErrorNote message={rotate.error.message} /> : null}
          <KeyTable
            rows={keys.data ?? []}
            pending={keys.isPending}
            error={keys.error?.message ?? null}
            onRevoke={(id) => revoke.mutate({ id })}
            onRotate={(id) => rotate.mutate({ id })}
            busy={revoke.isPending || rotate.isPending}
          />
        </CardContent>
      </Card>

      <ApiKeySecretDialog
        secret={secret ?? ""}
        open={secret !== null}
        onAcknowledged={() => setSecret(null)}
      />
    </div>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}

function CreateKeyDialog({ onIssued }: { onIssued: (secret: string) => void }) {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [scopes, setScopes] = React.useState<SelfServiceScope[]>(["repos:read"])

  const create = useMutation(
    trpc.apiKeys.createMine.mutationOptions({
      onSuccess: (result) => {
        onIssued(result.secret)
        setOpen(false)
        setName("")
        setScopes(["repos:read"])
      },
    })
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Leaving a failed submit's input in place is deliberate — the name and
        // the scopes are expensive to retype and the cooldown means the reader
        // will not be back here for a minute. Closing, though, always clears it,
        // so a half-filled form never reappears days later.
        if (!next) create.reset()
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={create.isPending}>
          <IconPlus className="size-4" />
          {t("newKey")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newKey")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate({ name, scopes })
          }}
          className="space-y-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="api-key-name">{t("name")}</Label>
            <Input
              id="api-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
              required
              maxLength={120}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t("scopes")}</Label>
            <ApiKeyScopePicker
              available={SELF_SERVICE_SCOPES}
              value={scopes}
              onChange={setScopes}
              idPrefix="self"
            />
          </div>

          {create.error ? <ErrorNote message={create.error.message} /> : null}

          <DialogFooter>
            <Button
              type="submit"
              disabled={create.isPending || scopes.length === 0}
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
 * A row of `listMine`, taken from the router's own output type.
 *
 * Restating the fields by hand is how this column set drifts: the list grows a
 * `lastRotatedAt`, the row type does not, and the table keeps rendering the old
 * set while the query returns more. `inferRouterOutputs` cannot drift.
 */
type KeyRow = inferRouterOutputs<
  typeof appRouter
>["apiKeys"]["listMine"][number]

function KeyTable({
  rows,
  pending,
  error,
  onRevoke,
  onRotate,
  busy,
}: {
  /** Inferred from the router's output rather than restated, so a column that
   *  disappears from `listMine` is a compile error here instead of `undefined`. */
  rows: readonly KeyRow[]
  pending: boolean
  error: string | null
  onRevoke: (id: string) => void
  onRotate: (id: string) => void
  busy: boolean
}) {
  const t = useTranslations("ApiKeys")

  if (error) return <ErrorNote message={error} />

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
          <TableHead>{t("scopes")}</TableHead>
          <TableHead>{t("rateLimit")}</TableHead>
          <TableHead>{t("lastUsed")}</TableHead>
          <TableHead className="text-right">{"action"}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <KeyRowView
            key={row.id}
            row={row}
            busy={busy}
            onRevoke={onRevoke}
            onRotate={onRotate}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function KeyRowView({
  row,
  busy,
  onRevoke,
  onRotate,
}: {
  row: KeyRow
  busy: boolean
  onRevoke: (id: string) => void
  onRotate: (id: string) => void
}) {
  const t = useTranslations("ApiKeys")
  const format = useFormats()
  const revoked = row.revokedAt !== null

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.name}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {t("prefix")} {row.prefix}
          </span>
          {revoked ? (
            <Badge variant="secondary" className="w-fit">
              {t("revoked")}
              {row.revokedReason ? ` · ${row.revokedReason}` : ""}
            </Badge>
          ) : null}
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
      <TableCell className="text-xs text-muted-foreground">
        {t("rateLimitValue", { rpm: row.rateLimitRpm, rpd: row.rateLimitRpd })}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.lastUsedAt ? format.dateTime(row.lastUsedAt) : t("never")}
      </TableCell>
      <TableCell className="space-x-1 text-right">
        {!revoked ? (
          <>
            <ConfirmButton
              label={t("rotate")}
              title={t("rotate")}
              description={t("rotateConfirm")}
              onConfirm={() => onRotate(row.id)}
              disabled={busy}
              icon={<IconRefresh className="size-4" />}
            />
            <ConfirmButton
              label={t("revoke")}
              title={t("revoke")}
              description={t("revokeConfirm")}
              onConfirm={() => onRevoke(row.id)}
              disabled={busy}
              destructive
            />
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("revokedAt", { date: format.dateTime(row.revokedAt) })}
          </span>
        )}
      </TableCell>
    </TableRow>
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
