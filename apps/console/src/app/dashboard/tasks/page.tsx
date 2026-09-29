import { DashboardLayout } from "@/components/dashboard-layout"
import { TasksContent } from "@/components/tasks/tasks-content"

export const dynamic = "force-dynamic"

export default function TasksPage() {
  return (
    <DashboardLayout title="Tasks">
      <TasksContent />
    </DashboardLayout>
  )
}
