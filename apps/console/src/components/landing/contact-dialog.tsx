"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { IconCheck, IconCopy } from "@tabler/icons-react"
import Image from "next/image"
import { useState } from "react"

import { CONTACT } from "@/lib/contact"

/**
 * 「联系团队」按钮 + 微信弹窗。
 *
 * 触发器的样式由调用方传入，所以价格卡的按钮与结尾 CTA 的按钮能共用这一个弹窗，
 * 而落地页其余按钮仍然是各自那一套（不套 shadcn `Button`，落地页的按钮全是手写
 * 的 Tailwind，跟它们保持一致比统一到组件上更重要）。
 *
 * 二维码与微信号都给全：手机扫码不方便的时候，复制微信号是同一条路。
 */

/** 二维码底衬必须留白，深色模式下白底是让码能被扫出来的前提，不是装饰。 */
function ContactQr() {
  return (
    <div className="mx-auto w-fit rounded-xl border border-border bg-white p-2">
      <Image
        src={CONTACT.qrSrc}
        alt="联系团队的微信二维码"
        width={176}
        height={176}
        className="size-44"
      />
    </div>
  )
}

/** 微信号与复制按钮。 */
function WechatId() {
  const [copied, setCopied] = useState(false)

  async function copy() {
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
    <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
      <span className="text-xs text-muted-foreground">微信号</span>
      <span className="flex items-center gap-2">
        <code className="font-mono text-sm">{CONTACT.wechatId}</code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <IconCheck size={13} aria-hidden /> : <IconCopy size={13} aria-hidden />}
          {copied ? "已复制" : "复制"}
        </button>
      </span>
    </div>
  )
}

export function ContactDialog({
  label = "联系团队",
  className,
  children,
}: {
  label?: string
  /** 触发器按钮的类名，由调用方按自己的版式给。 */
  className?: string
  children?: React.ReactNode
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={className}>
          {children ?? label}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>联系团队</DialogTitle>
          <DialogDescription>
            扫码加微信，或直接复制微信号。选型、部署与报价的问题都可以在这里问。
          </DialogDescription>
        </DialogHeader>
        <ContactQr />
        <WechatId />
      </DialogContent>
    </Dialog>
  )
}