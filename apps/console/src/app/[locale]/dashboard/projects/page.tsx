import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectsContent } from "@/components/projects/projects-content"

export const dynamic = "force-dynamic"

export default function ProjectsPage() {
  return (
    <DashboardLayout titleKey="Projects.title">
      <ProjectsContent />
    </DashboardLayout>
  )
}
