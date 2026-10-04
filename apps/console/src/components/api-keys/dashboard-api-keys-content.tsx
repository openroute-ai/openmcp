/**
 * `/dashboard/api-keys` — the operator's view of every key, plus the audit log.
 *
 * The operator page is where the two hard questions from §2.1 finally get
 * answered, and the order of the two tables is that order: **the audit log is
 * above the key list on purpose.** A key list answers "what is true now", and
 * during a credential incident "what is true now" is not the question — "who
 * changed this key, and when" is. Putting the history first means the operator
 * reading a support thread about a key that stopped working lands on the history
 * rather than having to notice it below the fold.
 *
 * Everything mutating here is `adminProcedure`. Nothing in this file is a
 * security decision: `reason` being required and `updateScopes` being immediate
 * are enforced by the router and `keys.ts`, not by whether this page rendered a
 * text field.
 */
"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocale, useTranslations } from "next-intl"
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
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import { IconKey, IconPlus } from "@tabler/icons-react"
import { ApiKeyScopePicker } from "@/components/api-keys/api-key-scope-picker"
import { ApiKeySecretDialog } from "@/components/api-keys/api-key-secret-dialog"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import type { inferRouterOutputs } from "@trpc/server"
import type { appRouter } from "@/lib/trpc/root"
import { API_SCOPES, type ApiScope, type ApiTier } from "@/lib/api/scopes"

/** `null` means "no filter", which is different from "a filter for no owner". */
type OwnerFilter = string | null | undefined

export function DashboardApiKeysContent() {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [owner, setOwner] = React.useState<OwnerFilter>(undefined)
  const [tier, setTier] = React.useState<ApiTier | undefined>(undefined)
  const [onlyActive, setOnlyActive] = React.useState(true)
  const [secret, setSecret] = React.useState<string | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.apiKeys.pathKey() })

  const keys = useQuery(
    trpc.apiKeys.list.queryOptions({
      onlyActive,
      // `undefined` is dropped by tRPC's serialiser; `null` survives and means
      // "only keys with no owner", which is a filter the operator wants and the
      // one a plain `if (owner)` would silently drop.
      userId: owner ?? undefined,
      tier,
    })
  )

  const audit = useQuery(trpc.apiKeys.audit.queryOptions({ limit: 25 }))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconKey className="size-4" />
            {t("auditTitle")}
          </CardTitle>
          <CardDescription>{t("auditDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <AuditTable entries={audit.data ?? []} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription className="sr-only">
            {t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="filter-owner">{t("filterOwner")}</Label>
              <Input
                id="filter-owner"
                className="w-56"
                placeholder={t("filterOwner")}
                value={owner ?? ""}
                onChange={(event) =>
                  // Empty is "no filter", not "no owner" — the two are different
                  // questions and an operator clearing the box means the first.
                  setOwner(event.target.value || undefined)
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-tier">{t("filterTier")}</Label>
              <NativeSelect
                size="sm"
                id="filter-tier"
                className="w-40"
                value={tier ?? "all"}
                onChange={(event) =>
                  setTier(
                    event.target.value === "all"
                      ? undefined
                      : (event.target.value as ApiTier)
                  )
                }
              >
                <NativeSelectOption value="all">
                  {t("filterOwnerAll")}
                </NativeSelectOption>
                <NativeSelectOption value="user">
                  {t("tierUser")}
                </NativeSelectOption>
                <NativeSelectOption value="service">
                  {t("tierService")}
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Checkbox
                checked={onlyActive}
                onCheckedChange={(value) => setOnlyActive(value === true)}
              />
              {t("onlyActive")}
            </label>
            <div className="ml-auto">
              <IssueKeyDialog
                onIssued={(value) => {
                  setSecret(value)
                  void invalidate()
                }}
              />
            </div>
          </div>

          {keys.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <KeyTable rows={keys.data ?? []} onChanged={invalidate} />
          )}
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

type KeyRow = inferRouterOutputs<typeof appRouter>["apiKeys"]["list"][number]

function KeyTable({
  rows,
  onChanged,
}: {
  rows: readonly KeyRow[]
  onChanged: () => void
}) {
  const t = useTranslations("ApiKeys")
  const format = useFormats()

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("empty")}
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("name")}</TableHead>
          <TableHead>{t("scopes")}</TableHead>
          <TableHead>{t("owner")}</TableHead>
          <TableHead>{t("rateLimit")}</TableHead>
          <TableHead>{t("lastUsed")}</TableHead>
          <TableHead className="text-right">{t("action")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b hover:bg-muted/50">
            <td className="p-2 align-middle">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{row.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {t("prefix")} {row.prefix}
                </span>
              </div>
            </td>
            <td className="p-2 align-middle">
              <div className="flex flex-wrap gap-1">
                {row.scopes.map((scope) => (
                  <Badge
                    key={scope}
                    variant="outline"
                    className="font-mono text-xs"
                  >
                    {scope}
                  </Badge>
                ))}
              </div>
            </td>
            <td className="p-2 align-middle">
              <div className="flex flex-col gap-1">
                <Badge variant={row.tier === "user" ? "default" : "secondary"}>
                  {row.tier === "user" ? t("tierUser") : t("tierService")}
                </Badge>
                {row.userId ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.userId}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t("ownerNone")}
                  </span>
                )}
              </div>
            </td>
            <td className="p-2 align-middle text-xs text-muted-foreground">
              {t("rateLimitValue", {
                rpm: row.rateLimitRpm,
                rpd: row.rateLimitRpd,
              })}
            </td>
            <td className="p-2 align-middle text-xs text-muted-foreground">
              {row.lastUsedAt ? format.dateTime(row.lastUsedAt) : t("never")}
            </td>
            <td className="p-2 text-right align-middle">
              {!row.revokedAt ? (
                <RowActions row={row} onChanged={onChanged} />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("revoked")}
                </span>
              )}
            </td>
          </tr>
        ))}
      </TableBody>
    </Table>
  )
}

type AuditEntry = inferRouterOutputs<
  typeof appRouter
>["apiKeys"]["audit"][number]

/** How each action reads as a phrase rather than as a dot-separated token. */
const ACTION_LABEL: Record<AuditEntry["action"], { en: string; zh: string }> = {
  "key.create": { en: "issued", zh: "签发" },
  "key.revoke": { en: "revoked", zh: "吊销" },
  "key.rotate": { en: "rotated", zh: "轮换" },
  "key.surrender": { en: "surrendered", zh: "放弃所有权" },
  "scopes.update": { en: "permissions changed", zh: "权限变更" },
  "limits.update": { en: "rate limit changed", zh: "限流变更" },
}

/**
 * A phrase for an action token, falling back to the token itself.
 *
 * The fallback is not defensive padding. `api_request_audit.action` is a `text`
 * column on purpose (see `0023`: adding an action should not need a migration), so
 * a row written by a newer version can hold a token this version has no label
 * for. Indexing `ACTION_LABEL` directly would make the whole audit table crash
 * on one unrecognised row -- and it would crash on the *most* interesting row,
 * since the newest actions are the ones this build predates.
 */
function actionLabel(action: string, locale: string): string {
  const phrase = ACTION_LABEL[action as AuditEntry["action"]]
  if (!phrase) return action
  return locale === "zh" ? phrase.zh : phrase.en
}

function AuditTable({ entries }: { entries: readonly AuditEntry[] }) {
  const t = useTranslations("ApiKeys")
  const format = useFormats()
  const locale = useLocale()

  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("auditDescription")}
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("when")}</TableHead>
          <TableHead>{t("action")}</TableHead>
          <TableHead>{t("actor")}</TableHead>
          <TableHead>{t("change")}</TableHead>
          <TableHead>{t("reason")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
              {format.dateTime(entry.createdAt)}
            </TableCell>
            <TableCell className="text-xs whitespace-nowrap">
              <Badge variant="outline">
                {actionLabel(entry.action, locale)}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {entry.userId ?? "—"}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {describeChange(entry)}
            </TableCell>
            <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
              {entry.reason ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * The `before` → `after` pair as one line.
 *
 * Rendered rather than dumped as raw JSON because the audit table's job is to be
 * scannable: an operator asking "what did this key gain?" should not have to
 * read two JSON blobs to learn that `projects:write` appeared. Falling back to
 * JSON for a shape this function does not know about keeps a new action visible
 * instead of blank.
 */
function describeChange(entry: AuditEntry): string {
  if (!entry.before && !entry.after) return "—"
  if (!entry.before) {
    const after = entry.after as Record<string, unknown> | null
    const scopes = after?.scopes
    if (Array.isArray(scopes)) return `+ ${scopes.join(", ")}`
    return JSON.stringify(entry.after)
  }
  if (!entry.after) return JSON.stringify(entry.before)

  const before = entry.before as Record<string, unknown>
  const after = entry.after as Record<string, unknown>
  const beforeScopes = before.scopes
  const afterScopes = after.scopes

  if (Array.isArray(beforeScopes) && Array.isArray(afterScopes)) {
    const added = afterScopes.filter((s) => !beforeScopes.includes(s))
    const removed = beforeScopes.filter((s) => !afterScopes.includes(s))
    return [
      added.length ? `+ ${added.join(", ")}` : "",
      removed.length ? `− ${removed.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("  ")
  }

  return JSON.stringify({ before: entry.before, after: entry.after })
}

function RowActions({
  row,
  onChanged,
}: {
  row: KeyRow
  onChanged: () => void
}) {
  return (
    <div className="space-x-1">
      <ScopesDialog row={row} onChanged={onChanged} />
      <LimitsDialog row={row} onChanged={onChanged} />
      <RevokeDialog row={row} onChanged={onChanged} />
    </div>
  )
}

/**
 * `reason` is a required field in a dialog rather than an optional one.
 *
 * It is the whole point of `revokeReason` being `min(1)`: three months later the
 * only answer to "why does this key not work any more" is a free-text box that
 * was required at the moment of the action. A dialog is the right place to make
 * it required because the operator is already typing.
 */
function ReasonField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (next: string) => void
}) {
  const t = useTranslations("ApiKeys")
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{t("reason")}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("reasonPlaceholder")}
        maxLength={500}
      />
      <p className="text-xs text-muted-foreground">{t("reasonHint")}</p>
    </div>
  )
}

function ScopesDialog({
  row,
  onChanged,
}: {
  row: KeyRow
  onChanged: () => void
}) {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const [scopes, setScopes] = React.useState<ApiScope[]>([...row.scopes])
  const [reason, setReason] = React.useState("")

  const mutation = useMutation(
    trpc.apiKeys.updateScopes.mutationOptions({
      onSuccess: (result) => {
        // `changed: false` means the operator re-confirmed what was already
        // there. Saying so is better than a silent close, because "nothing
        // happened" is the one outcome an operator cannot otherwise tell apart
        // from "it did not save".
        toast[result.changed ? "success" : "info"](
          result.changed ? t("scopesChanged") : t("noChange")
        )
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
          // Re-seed from the row on every open, so a cancelled edit does not
          // leave the next open holding the abandoned selection.
          setScopes([...row.scopes])
          setReason("")
          mutation.reset()
          setOpen(true)
        }}
      >
        {t("updateScopes")}
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("updateScopes")}</DialogTitle>
          <DialogDescription>{row.name}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate({ id: row.id, scopes, reason })
          }}
        >
          <ApiKeyScopePicker
            available={API_SCOPES}
            value={scopes}
            onChange={setScopes}
            idPrefix={`scopes-${row.id}`}
          />
          <ReasonField
            id={`reason-scopes-${row.id}`}
            value={reason}
            onChange={setReason}
          />
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                reason.trim().length === 0 ||
                scopes.length === 0
              }
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
  const [rpm, setRpm] = React.useState(String(row.rateLimitRpm))
  const [rpd, setRpd] = React.useState(String(row.rateLimitRpd))
  const [reason, setReason] = React.useState("")

  const mutation = useMutation(
    trpc.apiKeys.updateLimits.mutationOptions({
      onSuccess: (result) => {
        toast[result.changed ? "success" : "info"](
          result.changed ? t("limitsChanged") : t("noChange")
        )
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
          setRpm(String(row.rateLimitRpm))
          setRpd(String(row.rateLimitRpd))
          setReason("")
          mutation.reset()
          setOpen(true)
        }}
      >
        {t("updateLimits")}
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("updateLimits")}</DialogTitle>
          <DialogDescription>{row.name}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate({
              id: row.id,
              rateLimitRpm: Number(rpm),
              rateLimitRpd: Number(rpd),
              reason,
            })
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
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

function IssueKeyDialog({ onIssued }: { onIssued: (secret: string) => void }) {
  const t = useTranslations("ApiKeys")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [scopes, setScopes] = React.useState<ApiScope[]>(["repos:read"])
  const [owner, setOwner] = React.useState("")
  const [submitter, setSubmitter] = React.useState("")

  const ownerId = owner.trim() || null

  const mutation = useMutation(
    trpc.apiKeys.create.mutationOptions({
      onSuccess: (result) => {
        onIssued(result.secret)
        setOpen(false)
        setName("")
        setScopes(["repos:read"])
        setOwner("")
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
              // Derived here rather than collected: the tier is a function of the
              // owner, so asking the operator for both would let them state a pair
              // that `assertTierMatchesOwner` rejects — and the operator has no way
              // to know which half was wrong.
              userId: ownerId,
              tier: ownerId ? "user" : "service",
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
            <Label htmlFor="issue-owner">{t("owner")}</Label>
            <Input
              id="issue-owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder={t("ownerNone")}
            />
            <p className="text-xs text-muted-foreground">{t("ownerHint")}</p>
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
