"use client"

/**
 * 结账入口：一个按钮 + 它弹开的 `CheckoutDialog`。
 *
 * 用户侧有三个地方要点出同一个扫码弹窗——订阅页的付费闸、订阅页的续费、账单页的续费与
 * 开通——它们都一样是"已登录用户，点按钮 → 扫码"。把「open 状态 + 价目表查询 + 弹窗」
 * 收拾成一个组件，按钮文案与位置由调用方决定；价目表（`billing.checkoutConfig`）集中在
 * 这里查，而不是每个入口各查一份。
 *
 * 落地页不用它：落地页的定价卡把弹窗 open 状态交给「开始监控」按钮和 URL 里的
 * `?plan=pro`（登录回跳要自动重开），那是它自己的编排。
 */
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { CheckoutDialog } from "@/components/landing/checkout-dialog"
import { useTRPC } from "@/lib/trpc/client"

export function CheckoutButton({
  renewal = false,
  returnPath,
  disabled,
  children,
  ...buttonProps
}: {
  /** 生效期内续费（弹窗展示折后价）。判定真值在服务端，这里只管展示。 */
  renewal?: boolean
  /** 支付成功后「进入控制台」去哪。 */
  returnPath: string
  disabled?: boolean
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof Button>, "type" | "onClick">) {
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const checkout = useQuery(trpc.billing.checkoutConfig.queryOptions())

  return (
    <>
      <Button
        type="button"
        disabled={disabled || checkout.isPending}
        onClick={() => setOpen(true)}
        {...buttonProps}
      >
        {children}
      </Button>
      {checkout.data ? (
        <CheckoutDialog
          open={open}
          onOpenChange={setOpen}
          signedIn
          checkout={checkout.data}
          returnPath={returnPath}
          renewal={renewal}
        />
      ) : null}
    </>
  )
}