/**
 * 订阅创建成功之后的那一句确认。
 *
 * 它只做两件事：说清楚「建好了」，再把人送到验签文档。**不展示验签密钥**：那把密钥
 * 由用户自己签发的 api key 派生（`deriveSigningKey` 的两步配方），明文一直握在用户
 * 手里，让他照文档自己算一份，比在控制台里再抄一遍更不容易抄错——抄错的那份没有任何
 * 报错，只会让每一次投递都验签失败。
 *
 * 也**不拦**：勾选框、禁止点外面关闭、Escape 失效这些强制手段是为「丢了就没了」的明文
 * 准备的，对一个随时能重算的派生值只会变成无端的摩擦。这个弹窗被关掉没有任何代价，
 * 所以底下的建订阅表单跟着一起关（见 `ConsoleSubscriptionsContent`）——留着一层没人
 * 还需要的对话框，只会让人以为刚才那次提交没成功。
 */
"use client"

import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { LocaleLink } from "@/i18n/navigation"

/** 验签配方那一页的 slug：`content/docs/verify-signature.mdx`。 */
const VERIFY_DOC_PATH = "/docs/verify-signature"

export function SubscriptionCreatedDialog({
  open,
  onAcknowledged,
}: {
  open: boolean
  onAcknowledged: () => void
}) {
  const t = useTranslations("Subscriptions")

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onAcknowledged()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("createdTitle")}</DialogTitle>
          <DialogDescription>{t("createdBody")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <p>{t("createdVerify")}</p>
          <LocaleLink
            href={VERIFY_DOC_PATH}
            className="font-medium text-primary underline underline-offset-4"
          >
            {t("createdDocsLink")}
          </LocaleLink>
        </div>

        <DialogFooter>
          <Button type="button" onClick={onAcknowledged}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
