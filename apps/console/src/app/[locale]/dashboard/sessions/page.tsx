import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SessionsContent } from "@/components/sessions/sessions-content"

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return dashboardMetadata("Sessions.title")
}

export default function SessionsPage() {
  return (
    <DashboardLayout titleKey="Sessions.title">
      <SessionsContent />
    </DashboardLayout>
  )
}
