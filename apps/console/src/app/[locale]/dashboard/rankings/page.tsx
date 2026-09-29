import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { RankingsContent } from "@/components/rankings/rankings-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Nav.rankings")
}

export default function RankingsPage() {
  return (
    <DashboardLayout titleKey="Nav.rankings">
      <RankingsContent />
    </DashboardLayout>
  )
}
