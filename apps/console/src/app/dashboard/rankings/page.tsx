import { DashboardLayout } from "@/components/dashboard-layout"
import { RankingsContent } from "@/components/rankings/rankings-content"

export const dynamic = "force-dynamic"

export default function RankingsPage() {
  return (
    <DashboardLayout title="Rankings">
      <RankingsContent />
    </DashboardLayout>
  )
}
