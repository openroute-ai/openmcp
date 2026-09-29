import { DashboardLayout } from "@/components/dashboard-layout"
import { OverviewContent } from "@/components/overview/overview-content"

export const dynamic = "force-dynamic"

export default function DashboardPage() {
  return (
    <DashboardLayout title="Overview">
      <OverviewContent />
    </DashboardLayout>
  )
}
