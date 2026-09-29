import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SkillsContent } from "@/components/skills/skills-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Skills.title")
}

export default function SkillsPage() {
  return (
    <DashboardLayout titleKey="Skills.title">
      <SkillsContent />
    </DashboardLayout>
  )
}
