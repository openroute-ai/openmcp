import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { TasksContent } from "@/components/tasks/tasks-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Nav.tasks")
}

export default function TasksPage() {
  return (
    <DashboardLayout titleKey="Nav.tasks">
      <TasksContent />
    </DashboardLayout>
  )
}
