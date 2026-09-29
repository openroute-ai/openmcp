import { DashboardLayout } from "@/components/dashboard-layout"
import { SyncContent } from "@/components/sync/sync-content"

export const dynamic = "force-dynamic"

export default function SyncPage() {
  return (
    <DashboardLayout title="Sync Jobs">
      <SyncContent />
    </DashboardLayout>
  )
}
