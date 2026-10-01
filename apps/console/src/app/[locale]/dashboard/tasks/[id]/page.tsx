import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { TaskDetail } from "@/components/tasks/task-detail-content"

export const dynamic = "force-dynamic"

// The tab names the section the page belongs to. The task's name is not known
// here: the page is a shell and the data is fetched by the client, so putting it
// in the metadata would mean fetching it twice, on a path that runs before the
// page itself.
export async function generateMetadata() {
  return dashboardMetadata("Nav.tasks")
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { id } = await params

  return (
    <DashboardLayout titleKey="Nav.tasks">
      <TaskDetail id={id} />
    </DashboardLayout>
  )
}