"use client"

import { IconCheck, IconCopy } from "@tabler/icons-react"
import Image from "next/image"
import { useState } from "react"

import { CONTACT } from "@/lib/contact"

/**
 * 联系方式卡片：二维码 + 微信号（可一键复制）+ 可选邮箱。
 *
 * 和 `ContactDialog` 共用同一块内容，所以落地页的价格卡弹窗和 `/contact` 页面
 * 说的是同一个号——两处各写一份的代价是迟早只改一处。
 *
 * 二维码与文字都给：手机扫码不方便的时候，复制微信号是同一条路；而二维码扫不出来
 * 的唯一兜底就是那行字。邮箱只在 `CONTACT.email` 被填上时才出现——与其留一个没人看的
 * 占位地址，不如不显示。
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

export function ContactCard({
  className,
}: {
  className?: string
}) {
  return (
    <div
      className={
        className ??
        "grid w-full max-w-sm gap-3 rounded-2xl border border-border bg-card p-5"
      }
    >
      <ContactQr />
      <WechatId />
      {CONTACT.email ? (
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">邮箱</span>
          <a
            href={`mailto:${CONTACT.email}`}
            className="font-mono text-sm underline underline-offset-2"
          >
            {CONTACT.email}
          </a>
        </div>
      ) : null}
    </div>
  )
}
