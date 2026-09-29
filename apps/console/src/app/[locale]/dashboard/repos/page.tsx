import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ReposContent } from "@/components/repos/repos-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Repos.title")
}

export default function ReposPage() {
  return (
    <DashboardLayout titleKey="Repos.title">
      <ReposContent />
    </DashboardLayout>
  )
}
