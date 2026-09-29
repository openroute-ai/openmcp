import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectsContent } from "@/components/projects/projects-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Projects.title")
}

export default function ProjectsPage() {
  return (
    <DashboardLayout titleKey="Projects.title">
      <ProjectsContent />
    </DashboardLayout>
  )
}
