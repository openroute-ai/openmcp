import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { UsersContent } from "@/components/users/users-content"

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return dashboardMetadata("Users.title")
}

export default function UsersPage() {
  return (
    <DashboardLayout titleKey="Users.title">
      <UsersContent />
    </DashboardLayout>
  )
}
