import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SyncContent } from "@/components/sync/sync-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Sync.title")
}

export default function SyncPage() {
  return (
    <DashboardLayout titleKey="Sync.title">
      <SyncContent />
    </DashboardLayout>
  )
}
