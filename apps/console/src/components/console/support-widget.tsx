"use client"

import { useTranslations } from "next-intl"
import Image from "next/image"
import { useState, useSyncExternalStore } from "react"
import { IconCheck, IconCopy, IconHeadset, IconX } from "@tabler/icons-react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { CONTACT } from "@/lib/contact"

const SUPPORT_KEY = "vcx-console-support-dismissed"

/**
 * Whether the tech-support widget has been dismissed, as a store over
 * `localStorage`. Mirrors `landing/announce-bar.tsx`: the server snapshot is
 * the constant `true` so the widget is simply absent from the server HTML and
 * the hydration render agrees; React reads the real value right after
 * hydration and shows the widget for anyone who has not dismissed it.
 *
 * Returns `false` (i.e. show the widget) when storage is unavailable, so a
 * private-mode browser sees it every visit; dismissing there only hides it for
 * that session.
 */
function readSupportDismissed() {
  try {
    return localStorage.getItem(SUPPORT_KEY) === "1"
  } catch {
    return false
  }
}

const getSupportDismissedOnServer = () => true

let supportCache: boolean | undefined
const supportListeners = new Set<() => void>()

function getSupportDismissed() {
  return (supportCache ??= readSupportDismissed())
}

function setSupportDismissed() {
  supportCache = true
  for (const listener of supportListeners) listener()
}

function subscribeToSupport(listener: () => void) {
  supportListeners.add(listener)
  return () => {
    supportListeners.delete(listener)
  }
}

/**
 * The console's tech-support widget for the site header.
 *
 * A pill that opens a dialog with the contact card for reaching a human: the
 * WeChat QR from `CONTACT`, the WeChat id copied from the same source, and the
 * email when the config has one. The values come from `lib/contact.ts` so a
 * change of number touches one file, not every dialog that shows a QR.
 *
 * The pill's own `×` dismisses the widget for good: the flag is written to
 * `localStorage`, so the control stays gone on later logins on this device,
 * and once it is gone there is nothing left to click — the "don't show again"
 * decision lives on the widget, not inside the dialog's close.
 */
export function SupportWidget() {
  const t = useTranslations("Support")
  const dismissed = useSyncExternalStore(
    subscribeToSupport,
    getSupportDismissed,
    getSupportDismissedOnServer
  )
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  if (dismissed) return null

  const dismiss = () => {
    setSupportDismissed()
    try {
      localStorage.setItem(SUPPORT_KEY, "1")
    } catch {
      // ignore
    }
  }

  async function copyWechatId() {
    try {
      await navigator.clipboard.writeText(CONTACT.wechatId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {
      // 剪贴板不可用（非安全上下文、被策略拒绝）时静默失败：微信号以文本形式
      // 摆在上面，用户可以自己选中复制。
    }
  }

  return (
    <>
      <div className="inline-flex items-center rounded-full border border-border bg-background">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("openLabel")}
          className="gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(true)}
        >
          <IconHeadset size={16} />
          <span className="hidden md:inline">{t("title")}</span>
        </Button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismissLabel")}
          className="mr-1 grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconX size={13} />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconHeadset size={18} className="text-green-600" />
              {t("title")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="mx-auto w-fit rounded-lg border border-border bg-white p-2 shadow-sm">
              <Image
                src={CONTACT.qrSrc}
                alt={t("qrAlt")}
                width={176}
                height={176}
                className="size-44 object-contain"
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">
                {t("wechatIdLabel")}
              </span>
              <span className="flex items-center gap-2">
                <code className="font-mono text-sm">{CONTACT.wechatId}</code>
                <button
                  type="button"
                  onClick={() => void copyWechatId()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {copied ? (
                    <IconCheck size={13} aria-hidden />
                  ) : (
                    <IconCopy size={13} aria-hidden />
                  )}
                  {copied ? t("copied") : t("copy")}
                </button>
              </span>
            </div>

            {CONTACT.email ? (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">
                  {t("emailLabel")}
                </span>
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="font-mono text-sm underline underline-offset-2"
                >
                  {CONTACT.email}
                </a>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
