/**
 * `/console/connections` — 接入方配对码（设计文档 §2.11）。
 *
 * 这个页面的产出是一个**八位码**和一段给接入方的说明：把码交给对方，对方拿
 * `POST /api/v1/connections/redeem` 换成一把 `user` tier 的 key。所以页面本身不发 key，
 * 也不显示任何明文 key —— 它显示的是码，而码 5 分钟后就废了。
 *
 * 三处刻意的取舍：
 *
 * - 码用**对话框**展示而不是内联卡片。码要被抄走，一次只弹一个，也不会随着列表刷新
 *   出现在页面上；5 分钟过期的东西做成常驻条目只会让人反复读到它已经废了。
 * - 没有"重新生成"按钮。作废后重新建一个就是重新生成，而"保留还是作废"是一个要
 *   用户自己判断的事。
 * - 权限判断一处都不在这个文件里。见 `routers/connections.ts` 的文件头。
 */
"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
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
import { IconCheck, IconCopy, IconPlus, IconTrash } from "@tabler/icons-react"
import { ApiKeyScopePicker } from "@/components/api-keys/api-key-scope-picker"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import {
  SELF_SERVICE_SCOPES,
  TIER_DEFAULTS,
  type SelfServiceScope,
} from "@/lib/api/scopes"
import type { inferRouterOutputs } from "@trpc/server"
import type { appRouter } from "@/lib/trpc/root"

export function ConsoleConnectionsContent() {
  const t = useTranslations("Connections")
  const formats = useFormats()
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [issued, setIssued] = React.useState<IssuedCode | null>(null)

  const pairings = useQuery(
    trpc.connections.listMine.queryOptions(undefined, {
      // Same reason as the key list: a background refetch would replace the row
      // someone is reaching for "cancel" on, and this list is at most a handful.
      refetchOnWindowFocus: false,
    })
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.connections.pathKey() })

  const revoke = useMutation(
    trpc.connections.revoke.mutationOptions({
      onSuccess: () => void invalidate(),
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
          <CreateCodeDialog onIssued={setIssued} />
          {revoke.error ? <ErrorNote message={revoke.error.message} /> : null}
          <PairingTable
            rows={pairings.data ?? []}
            pending={pairings.isPending}
            error={pairings.error?.message ?? null}
            formatDate={formats.dateTime}
            onRevoke={(code) => revoke.mutate({ code })}
            busy={revoke.isPending}
          />
        </CardContent>
      </Card>

      <IssuedCodeDialog code={issued} onClosed={() => setIssued(null)} />
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

type IssuedCode = {
  code: string
  expiresAt: Date
  scopes: string[]
  returnUrl: string
}

/**
 * 建码表单。
 *
 * 默认 scope 是 `repos:read`，与自助签发页一致：两者发出的都是 `user` tier 的 key，
 * 而这把 key 的实际用途（读榜单、提交仓库）不需要更多权限。`returnUrl` 没有默认值 ——
 * 它必须由接入方给，而猜一个"看起来像回调地址"的默认值只会在兑换时被拒。
 */
function CreateCodeDialog({
  onIssued,
}: {
  onIssued: (value: IssuedCode) => void
}) {
  const t = useTranslations("Connections")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [scopes, setScopes] = React.useState<SelfServiceScope[]>(["repos:read"])
  const [returnUrl, setReturnUrl] = React.useState("")

  const create = useMutation(
    trpc.connections.create.mutationOptions({
      onSuccess: (result) => {
        onIssued({ ...result, expiresAt: new Date(result.expiresAt) })
        setOpen(false)
        setName("")
        setReturnUrl("")
        setScopes(["repos:read"])
      },
    })
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // 失败时保留输入：有效期还没开始计时，重填一遍比重新想一遍便宜。
        // 但显式关闭一定清空，免得半截表单过几天还在。
        if (!next) create.reset()
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={create.isPending}>
          <IconPlus className="size-4" />
          {t("newCode")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newCode")}</DialogTitle>
          <DialogDescription>{t("formDescription")}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate({ name, scopes, returnUrl })
          }}
          className="space-y-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="pairing-name">{t("name")}</Label>
            <Input
              id="pairing-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
              required
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground">{t("nameHint")}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pairing-return-url">{t("returnUrl")}</Label>
            <Input
              id="pairing-return-url"
              value={returnUrl}
              onChange={(event) => setReturnUrl(event.target.value)}
              placeholder="https://your-service.example/callback"
              required
              maxLength={2048}
            />
            <p className="text-xs text-muted-foreground">
              {t("returnUrlHint")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label>{t("scopes")}</Label>
            <ApiKeyScopePicker
              available={SELF_SERVICE_SCOPES}
              value={scopes}
              onChange={setScopes}
              idPrefix="pairing"
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
 * 一次性展示码。
 *
 * 和 `ApiKeySecretDialog` 同样的逻辑：不能因为误点而关掉，因为过了 5 分钟
 * "关闭前没抄"就等于要重建一个。这里没有"已保存"复选框——码不是凭据，
 * 它是一段要在 5 分钟内用掉的一次性字符串，所以复选框只是多一次点击。
 */
function IssuedCodeDialog({
  code,
  onClosed,
}: {
  code: IssuedCode | null
  onClosed: () => void
}) {
  return (
    <Dialog open={code !== null} onOpenChange={(next) => !next && onClosed()}>
      <DialogContent className="sm:max-w-lg">
        {code === null ? null : (
          // `key` remounts the body per code, so `copied` resets without an
          // effect -- a stale "copied" tick next to a new code is exactly the
          // state that makes someone paste the old one. See
          // `api-key-secret-dialog.tsx` for the longer version of this.
          <IssuedCodeBody key={code.code} code={code} onClosed={onClosed} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function IssuedCodeBody({
  code,
  onClosed,
}: {
  code: IssuedCode
  onClosed: () => void
}) {
  const t = useTranslations("Connections")
  const formats = useFormats()
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code.code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("issuedTitle")}</DialogTitle>
        <DialogDescription>{t("issuedWarning")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="block w-full overflow-x-auto rounded-md bg-muted p-3 font-mono text-lg tracking-widest select-all">
            {code.code}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={copy}
            aria-label={copied ? t("copied") : t("copy")}
          >
            {copied ? (
              <IconCheck className="size-4" />
            ) : (
              <IconCopy className="size-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("expiresAt", { date: formats.dateTime(code.expiresAt) })}
        </p>
      </div>

      <div className="space-y-2 rounded-md border p-3 text-sm">
        <p className="font-medium">{t("handOver")}</p>
        <p className="text-xs text-muted-foreground">{t("handOverHint")}</p>
        <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
          <li>{t("stepExchange", { returnUrl: code.returnUrl })}</li>
          {/* 兑换出来的是 `user` tier，配额取自 `TIER_DEFAULTS` 而不是写死数字：
              写死的那个值上一次就已经和实际签发的不一致了（写着 60，实际 30）。 */}
          <li>
            {t("stepKey", {
              rpm: String(TIER_DEFAULTS.user.rpm),
              rpd: String(TIER_DEFAULTS.user.rpd),
            })}
          </li>
        </ul>
      </div>

      <DialogFooter>
        <Button type="button" onClick={onClosed}>
          {t("done")}
        </Button>
      </DialogFooter>
    </>
  )
}

/** 行类型取自 router 输出，所以 `listMine` 少一个字段这里会编译失败。 */
type PairingRow = inferRouterOutputs<
  typeof appRouter
>["connections"]["listMine"][number]

function PairingTable({
  rows,
  pending,
  error,
  formatDate,
  onRevoke,
  busy,
}: {
  rows: readonly PairingRow[]
  pending: boolean
  error: string | null
  formatDate: (value: Date) => string
  onRevoke: (code: string) => void
  busy: boolean
}) {
  const t = useTranslations("Connections")

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
          <TableHead>{t("code")}</TableHead>
          <TableHead>{t("returnUrl")}</TableHead>
          <TableHead>{t("expires")}</TableHead>
          <TableHead className="text-right">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell>
              <Badge variant="secondary" className="font-mono tracking-widest">
                {row.code}
              </Badge>
            </TableCell>
            <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
              {row.returnUrl}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDate(row.expiresAt)}
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                onClick={() => onRevoke(row.code)}
                aria-label={t("revoke")}
              >
                <IconTrash className="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
