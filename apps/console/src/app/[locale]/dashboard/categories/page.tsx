import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { CategoriesContent } from "@/components/categories/categories-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Categories.title")
}

export default function CategoriesPage() {
  return (
    <DashboardLayout titleKey="Categories.title">
      <CategoriesContent />
    </DashboardLayout>
  )
}
