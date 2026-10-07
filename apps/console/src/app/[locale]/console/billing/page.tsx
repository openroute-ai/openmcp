import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleBillingContent } from "@/components/billing/console-billing-content"
import { dashboardMetadata } from "@/components/dashboard-metadata"

export const dynamic = "force-dynamic"

export const generateMetadata = () => dashboardMetadata("Billing.title")

/**
 * 普通用户自己的账号账单：我的订阅 + 支付历史。
 *
 * 两段都与运营侧的 `/dashboard/billing` 共享语义（`activeUntil` 就是全部状态、金额以
 * 分存储），但归属条件按 session 过滤——页面上没有一处权限判断，决定权在 tRPC 的
 * `protectedProcedure` 与 SQL 的 `user_id = session.user.id`。
 */
export default function ConsoleBillingPage() {
  return (
    <ConsoleLayout titleKey="Billing.title">
      <ConsoleBillingContent />
    </ConsoleLayout>
  )
}