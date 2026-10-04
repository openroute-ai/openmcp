import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardApiKeysContent } from "@/components/api-keys/dashboard-api-keys-content"

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return dashboardMetadata("ApiKeys.title")
}

/**
 * Every API key, plus the audit log of who changed what.
 *
 * `dynamic` is forced because this list changes as keys are issued, revoked and
 * surrendered, and because a cached operator view would keep showing a revoked
 * key as live.
 */
export default function DashboardApiKeysPage() {
  return (
    <DashboardLayout titleKey="ApiKeys.title">
      <DashboardApiKeysContent />
    </DashboardLayout>
  )
}
