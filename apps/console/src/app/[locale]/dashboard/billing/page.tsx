import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardBillingContent } from "@/components/billing/dashboard-billing-content"

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return dashboardMetadata("Billing.title")
}

export default function BillingPage() {
  return (
    <DashboardLayout titleKey="Billing.title">
      <DashboardBillingContent />
    </DashboardLayout>
  )
}