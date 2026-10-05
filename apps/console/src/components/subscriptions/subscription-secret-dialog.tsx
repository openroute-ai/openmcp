/**
 * 订阅签名密钥的一次性明文。
 *
 * 与 `ApiKeySecretDialog` 同一套强制手段，而这里的理由更硬：订阅密钥是用来做 HMAC 签名
 * 的（§6.5），签发之后服务端只存 `sha256(明文)`。收件方拿不到这把密钥，就永远验不过
 * 签名，而订阅"看起来一直在跑"——所以"读到了但没抄走"这件事必须不可能发生：在勾选确认
 * 之前，点外面与 Escape 都不关闭。
 *
 * 正文按 `secret` 做 `key` 重挂载而不是用 effect 重置：后者要在每次 `open` 变化时多跑一
 * 遍渲染，并且会让上一把密钥的"已保存"在某一帧里保持勾选——而那正是悄悄丢一把密钥的
 * 状态。
 */
"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import { IconAlertTriangle, IconCheck, IconCopy } from "@tabler/icons-react"

export function SubscriptionSecretDialog({
  secret,
  open,
  onAcknowledged,
}: {
  /** 服务端生成或调用方自带的那把密钥，形如 `<4 位前缀>_<43 位 base64url>`。 */
  secret: string
  open: boolean
  onAcknowledged: () => void
}) {
  const [stored, setStored] = React.useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !stored) return
        if (!next) onAcknowledged()
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(event) => {
          if (!stored) event.preventDefault()
        }}
        onEscapeKeyDown={(event) => {
          if (!stored) event.preventDefault()
        }}
      >
        <SecretBody
          key={secret}
          secret={secret}
          stored={stored}
          onStoredChange={setStored}
          onAcknowledged={onAcknowledged}
        />
      </DialogContent>
    </Dialog>
  )
}

function SecretBody({
  secret,
  stored,
  onStoredChange,
  onAcknowledged,
}: {
  secret: string
  stored: boolean
  onStoredChange: (value: boolean) => void
  onAcknowledged: () => void
}) {
  const t = useTranslations("Subscriptions")
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      // An insecure origin or an unfocused document. The value stays selectable,
      // so this loses a convenience rather than dead-ending — but it must not
      // read as success, hence no `setCopied`.
      setCopied(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("secretTitle")}</DialogTitle>
        <DialogDescription>{t("secretWarning")}</DialogDescription>
      </DialogHeader>

      <Alert variant="destructive">
        <IconAlertTriangle className="size-4" />
        <AlertDescription>{t("secretWarning")}</AlertDescription>
      </Alert>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="block w-full overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm break-all select-all">
            {secret}
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
        {copied ? (
          <p className="text-xs text-muted-foreground">{t("copied")}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="subscription-secret-stored"
          checked={stored}
          onCheckedChange={(value) => onStoredChange(value === true)}
        />
        <Label htmlFor="subscription-secret-stored" className="text-sm font-normal">
          {t("secretStored")}
        </Label>
      </div>

      <DialogFooter>
        <Button type="button" onClick={onAcknowledged} disabled={!stored}>
          {t("close")}
        </Button>
      </DialogFooter>
    </>
  )
}