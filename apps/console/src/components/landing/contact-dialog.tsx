"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"

import { ContactCard } from "@/components/landing/contact-card"

/**
 * 「联系团队」按钮 + 微信弹窗。
 *
 * 触发器的样式由调用方传入，所以价格卡的按钮与结尾 CTA 的按钮能共用这一个弹窗，
 * 而落地页其余按钮仍然是各自那一套（不套 shadcn `Button`，落地页的按钮全是手写
 * 的 Tailwind，跟它们保持一致比统一到组件上更重要）。
 *
 * 弹窗里的联系方式来自 `ContactCard`，和 `/contact` 页面是同一块内容。
 */

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
        <ContactCard className="gap-3" />
      </DialogContent>
    </Dialog>
  )
}
