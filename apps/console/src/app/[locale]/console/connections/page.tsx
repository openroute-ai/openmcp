import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleConnectionsContent } from "@/components/connections/console-connections-content"
import { dashboardMetadata } from "@/components/dashboard-metadata"

export const dynamic = "force-dynamic"

export const generateMetadata = () => dashboardMetadata("Connections.title")

/**
 * 接入方配对码。
 *
 * `dynamic` 被强制打开的原因和 `/console/api-keys` 一样：列表按 session 过滤，
 * 缓存的渲染会把一个读者的码交给另一个读者。布局已经确认了读者不是管理员，
 * 而真正决定"能改哪些码"的是 `routers/connections.ts` 里的 `user_id = session.user.id`。
 */
export default function ConsoleConnectionsPage() {
  return (
    <ConsoleLayout titleKey="Connections.title">
      <ConsoleConnectionsContent />
    </ConsoleLayout>
  )
}
