import { notFound } from "next/navigation"

import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { CategoryDetailContent } from "@/components/categories/category-detail-content"
import { db } from "@/db/client"
import { getCategoryByCode } from "@/lib/github/service/category"

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return dashboardMetadata("Categories.title")
}

/**
 * One category, and the projects filed under it.
 *
 * The list is paged on the server (`categories.projects`) rather than sliced in
 * the client for the same reason `/dashboard/projects` pages there: the total
 * and the rows have to answer the same set, and a category is an open shelf that
 * grows without bound.
 *
 * The admin gate is the layout's, and every read behind it re-checks the role in
 * the procedure — this page only answers 404 for a code that does not exist.
 */
export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ locale: string; category: string }>
}) {
  const { category: code } = await params

  const row = await getCategoryByCode(db, code)
  if (!row) notFound()

  return (
    <DashboardLayout titleKey="Categories.title">
      <CategoryDetailContent code={code} />
    </DashboardLayout>
  )
}
