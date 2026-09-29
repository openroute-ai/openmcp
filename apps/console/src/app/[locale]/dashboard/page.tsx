import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { OverviewContent } from "@/components/overview/overview-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Overview.title")
}

export default function DashboardPage() {
  return (
    <DashboardLayout titleKey="Overview.title">
      <OverviewContent />
    </DashboardLayout>
  )
}
