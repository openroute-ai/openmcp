import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardSubscriptionsContent } from "@/components/subscriptions/dashboard-subscriptions-content"

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return dashboardMetadata("Subscriptions.adminTitle")
}

/**
 * 全部订阅，加上停用（设计文档 §6.7）。
 *
 * `dynamic` 被强制打开，因为这个列表与"现在还在跑的那些"绑定：一份缓存的治理视图会把
 * 刚被停用的订阅继续显示成启用中，而那正是有人来这里确认的事情。
 */
export default function DashboardSubscriptionsPage() {
  return (
    <DashboardLayout titleKey="Subscriptions.adminTitle">
      <DashboardSubscriptionsContent />
    </DashboardLayout>
  )
}
