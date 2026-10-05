/**
 * API keys for a specific user (admin view on user detail).
 *
 * This component lists all keys belonging to `userId`, allows issuing a new key
 * for that user, and exposes admin operations (revoke with reason, rotate,
 * update scopes, update limits).
 */
"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
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
import { IconKey, IconPlus } from "@tabler/icons-react"
import { ApiKeyScopePicker } from "@/components/api-keys/api-key-scope-picker"
import { ApiKeySecretDialog } from "@/components/api-keys/api-key-secret-dialog"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import type { inferRouterOutputs } from "@trpc/server"
import type { appRouter } from "@/lib/trpc/root"
import { API_SCOPES, type ApiScope } from "@/lib/api/scopes"

type KeyRow = inferRouterOutputs<typeof appRouter>["apiKeys"]["list"][number]

export function UserApiKeysContent({ userId }: { userId: string }) {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [secret, setSecret] = React.useState<string | null>(null)
  const [onlyActive, setOnlyActive] = React.useState(true)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.apiKeys.pathKey() })

  const keys = useQuery(
    trpc.apiKeys.list.queryOptions({
      onlyActive,
      userId,
    })
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <IconKey className="size-4" />
              {t("title")}
            </CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
              />
              {t("onlyActive")}
            </label>
            <IssueKeyForUserDialog
              userId={userId}
              onIssued={(value) => {
                setSecret(value)
                void invalidate()
              }}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {keys.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <KeyTable rows={keys.data ?? []} onChanged={invalidate} />
        )}
      </CardContent>
      <ApiKeySecretDialog
        secret={secret ?? ""}
        open={secret !== null}
        onAcknowledged={() => setSecret(null)}
      />
    </Card>
  )
}

function KeyTable({
  rows,
  onChanged,
}: {
  rows: KeyRow[]
  onChanged: () => void
}) {
  const formats = useFormats()
  const t = useTranslations("ApiKeys")

  if (rows.length === 0) {
    return (
      <div className="rounded-md border py-10 text-center text-sm text-muted-foreground">
        {t("empty")}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("name")}</TableHead>
          <TableHead>{t("prefix")}</TableHead>
          <TableHead>{t("tier")}</TableHead>
          <TableHead>{t("scopes")}</TableHead>
          <TableHead>{t("status")}</TableHead>
          <TableHead>{t("createdAt")}</TableHead>
          <TableHead>{t("lastUsedAt")}</TableHead>
          <TableHead>{t("revokedTime")}</TableHead>
          <TableHead>{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="max-w-40 truncate font-medium">
              {row.name ?? "—"}
            </TableCell>
            <TableCell>
              <code className="font-mono text-xs">{row.prefix}</code>
            </TableCell>
            <TableCell>
              <Badge variant="outline">
                {row.tier === "user" ? t("tierUser") : t("tierService")}
              </Badge>
            </TableCell>
            <TableCell className="max-w-60">
              <ScopeChips scopes={row.scopes} />
            </TableCell>
            <TableCell>
              {row.revokedAt ? (
                <Badge
                  variant="outline"
                  className="border-destructive/40 text-destructive"
                >
                  {t("revoked")}
                </Badge>
              ) : row.expiresAt && row.expiresAt < new Date() ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 text-amber-600 dark:text-amber-400"
                >
                  {t("expired")}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                >
                  {t("active")}
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formats.relative(row.createdAt)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {row.lastUsedAt ? formats.relative(row.lastUsedAt) : "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {row.revokedAt ? formats.relative(row.revokedAt) : "—"}
            </TableCell>
            <TableCell>
              {!row.revokedAt ? (
                <div className="flex flex-wrap items-center gap-2">
                  <RotateDialog row={row} onChanged={onChanged} />
                  <ScopeDialog row={row} onChanged={onChanged} />
                  <LimitsDialog row={row} onChanged={onChanged} />
                  <RevokeDialog row={row} onChanged={onChanged} />
                </div>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ScopeChips({ scopes }: { scopes: ApiScope[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.map((scope) => (
        <Badge key={scope} variant="outline" className="text-xs">
          {scope}
        </Badge>
      ))}
    </div>
  )
}

function ReasonField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const t = useTranslations("ApiKeys")
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t("reason")}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("reasonPlaceholder")}
        required
      />
    </div>
  )
}

function RotateDialog({
  row,
  onChanged,
}: {
  row: KeyRow
  onChanged: () => void
}) {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const [secret, setSecret] = React.useState<string | null>(null)

  const mutation = useMutation(
    trpc.apiKeys.rotate.mutationOptions({
      onSuccess: (result) => {
        setSecret(result.issued.secret)
        onChanged()
        setOpen(false)
      },
      onError: (error) => toast.error(error.message),
    })
  )

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          mutation.reset()
          setOpen(true)
        }}
      >
        {t("rotate")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rotate")}</DialogTitle>
            <DialogDescription>{t("rotateConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => mutation.mutate({ id: row.id })}
              disabled={mutation.isPending}
            >
              {t("rotate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ApiKeySecretDialog
        secret={secret ?? ""}
        open={secret !== null}
        onAcknowledged={() => setSecret(null)}
      />
    </>
  )
}

function ScopeDialog({
  row,
  onChanged,
}: {
  row: KeyRow
  onChanged: () => void
}) {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [scopes, setScopes] = React.useState<ApiScope[]>(row.scopes)

  const mutation = useMutation(
    trpc.apiKeys.updateScopes.mutationOptions({
      onSuccess: () => {
        toast.success(t("scopesUpdated"))
        setOpen(false)
        setReason("")
        onChanged()
      },
      onError: (error) => toast.error(error.message),
    })
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setScopes(row.scopes)
          setReason("")
          mutation.reset()
          setOpen(true)
        }}
      >
        {t("scopes")}
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("updateScopes")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate({ id: row.id, scopes, reason })
          }}
        >
          <div className="grid gap-2">
            <Label>{t("scopes")}</Label>
            <ApiKeyScopePicker
              available={API_SCOPES}
              value={scopes}
              onChange={setScopes}
              idPrefix={`scope-${row.id}`}
            />
          </div>
          <ReasonField
            id={`reason-scope-${row.id}`}
            value={reason}
            onChange={setReason}
          />
          <DialogFooter>
            <Button
              type="submit"
              disabled={mutation.isPending || reason.trim().length === 0}
            >
              {t("updateScopes")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LimitsDialog({
  row,
  onChanged,
}: {
  row: KeyRow
  onChanged: () => void
}) {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const [rpm, setRpm] = React.useState(String(row.rateLimitRpm ?? ""))
  const [rpd, setRpd] = React.useState(String(row.rateLimitRpd ?? ""))
  const [reason, setReason] = React.useState("")

  const mutation = useMutation(
    trpc.apiKeys.updateLimits.mutationOptions({
      onSuccess: () => {
        toast.success(t("limitsUpdated"))
        setOpen(false)
        setReason("")
        onChanged()
      },
      onError: (error) => toast.error(error.message),
    })
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setRpm(String(row.rateLimitRpm ?? ""))
          setRpd(String(row.rateLimitRpd ?? ""))
          setReason("")
          mutation.reset()
          setOpen(true)
        }}
      >
        {t("limits")}
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("updateLimits")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const rpmNum = Number(rpm)
            const rpdNum = Number(rpd)
            mutation.mutate({
              id: row.id,
              rateLimitRpm: isNaN(rpmNum) ? undefined : rpmNum,
              rateLimitRpd: isNaN(rpdNum) ? undefined : rpdNum,
              reason,
            })
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`rpm-${row.id}`}>rpm</Label>
              <Input
                id={`rpm-${row.id}`}
                type="number"
                min={1}
                max={1000}
                value={rpm}
                onChange={(event) => setRpm(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`rpd-${row.id}`}>rpd</Label>
              <Input
                id={`rpd-${row.id}`}
                type="number"
                min={1}
                max={1_000_000}
                value={rpd}
                onChange={(event) => setRpd(event.target.value)}
              />
            </div>
          </div>
          <ReasonField
            id={`reason-limits-${row.id}`}
            value={reason}
            onChange={setReason}
          />
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                reason.trim().length === 0 ||
                !Number.isInteger(Number(rpm)) ||
                !Number.isInteger(Number(rpd))
              }
            >
              {t("updateLimits")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RevokeDialog({
  row,
  onChanged,
}: {
  row: KeyRow
  onChanged: () => void
}) {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")

  const mutation = useMutation(
    trpc.apiKeys.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(t("revokeDone"))
        setOpen(false)
        setReason("")
        onChanged()
      },
      onError: (error) => toast.error(error.message),
    })
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() => {
          setReason("")
          mutation.reset()
          setOpen(true)
        }}
      >
        {t("revoke")}
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("revoke")}</DialogTitle>
          <DialogDescription>{t("revokeConfirm")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate({ id: row.id, reason })
          }}
        >
          <ReasonField
            id={`reason-revoke-${row.id}`}
            value={reason}
            onChange={setReason}
          />
          <DialogFooter>
            <Button
              type="submit"
              variant="destructive"
              disabled={mutation.isPending || reason.trim().length === 0}
            >
              {t("revoke")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function IssueKeyForUserDialog({
  userId,
  onIssued,
}: {
  userId: string
  onIssued: (secret: string) => void
}) {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [scopes, setScopes] = React.useState<ApiScope[]>(["repos:read"])
  const [submitter, setSubmitter] = React.useState("")

  const mutation = useMutation(
    trpc.apiKeys.create.mutationOptions({
      onSuccess: (result) => {
        onIssued(result.secret)
        setOpen(false)
        setName("")
        setScopes(["repos:read"])
        setSubmitter("")
      },
      onError: (error) => toast.error(error.message),
    })
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          mutation.reset()
          setOpen(true)
        }}
      >
        <IconPlus className="size-4" />
        {t("newKey")}
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newKeyTitle")}</DialogTitle>
          <DialogDescription>{t("tierHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate({
              name,
              scopes,
              userId: userId,
              tier: "user",
              submitterId: submitter.trim() || null,
            })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="issue-name">{t("name")}</Label>
            <Input
              id="issue-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
              required
              maxLength={120}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="issue-submitter">{t("issuedOnBehalf")}</Label>
            <Input
              id="issue-submitter"
              value={submitter}
              onChange={(event) => setSubmitter(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t("scopes")}</Label>
            <ApiKeyScopePicker
              available={API_SCOPES}
              value={scopes}
              onChange={setScopes}
              idPrefix="issue"
            />
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={mutation.isPending || scopes.length === 0}
            >
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
