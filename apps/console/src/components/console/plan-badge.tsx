"use client"

import { useQuery } from "@tanstack/react-query"
import { useTRPC } from "@/lib/trpc/client"

/**
 * 页头上的 Pro 徽标——「我已经付过钱了」的那一个常驻标记。
 *
 * 与落地页那张 Pro 卡读的是同一列（`user_subscriptions.activeUntil`），走的却是
 * tRPC `billing.getMySubscription`：控制台的首屏是服务端渲染的，而徽标要能在
 * **不刷新页面**的情况下出现——扫码支付成功的那一刻，弹窗会 invalidate 这个
 * queryKey，徽标紧接着就在这里冒出来，用户不用离开当前页就知道钱到了。
 *
 * 没有订阅就渲染 `null`：一个几乎所有人都没有的徽标不该在页头占一个空位。
 */
export function PlanBadge() {
  const trpc = useTRPC()
  const { data: subscription } = useQuery(
    trpc.billing.getMySubscription.queryOptions()
  )

  if (!subscription) return null

  const until = subscription.activeUntil.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  })

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
      <span className="size-1.5 rounded-full bg-primary" aria-hidden />
      Pro · {until} 到期
    </span>
  )
}
