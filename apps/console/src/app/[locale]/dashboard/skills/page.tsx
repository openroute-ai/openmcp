import { DashboardLayout } from "@/components/dashboard-layout"
import { SkillsContent } from "@/components/skills/skills-content"

export const dynamic = "force-dynamic"

export default function SkillsPage() {
  return (
    <DashboardLayout titleKey="Skills.title">
      <SkillsContent />
    </DashboardLayout>
  )
}
