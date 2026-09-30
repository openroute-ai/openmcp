import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { AuthorsContent } from "@/components/authors/authors-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Authors.title")
}

export default function AuthorsPage() {
  return (
    <DashboardLayout titleKey="Authors.title">
      <AuthorsContent />
    </DashboardLayout>
  )
}
