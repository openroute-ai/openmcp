import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleSubscriptionsContent } from "@/components/subscriptions/console-subscriptions-content"
import { dashboardMetadata } from "@/components/dashboard-metadata"

export const dynamic = "force-dynamic"

export const generateMetadata = () => dashboardMetadata("Subscriptions.title")

/**
 * 自己的订阅（设计文档 §6.7）。
 *
 * `dynamic` 被强制打开，理由和 `/console/api-keys` 一样：列表按 session 过滤，
 * 缓存的渲染会把一个读者的订阅交给另一个读者。布局已经确认读者登录了，而真正决定
 * "能改哪些订阅"的是 `routers/subscriptions.ts` 里服务层的 `user_id = session.user.id`。
 */
export default function ConsoleSubscriptionsPage() {
  return (
    <ConsoleLayout titleKey="Subscriptions.title">
      <ConsoleSubscriptionsContent />
    </ConsoleLayout>
  )
}
