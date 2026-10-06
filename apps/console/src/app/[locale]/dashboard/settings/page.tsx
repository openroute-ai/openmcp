import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SettingsContent } from "@/components/settings/settings-content"

export const dynamic = "force-dynamic"

// Named for the same message the header shows, so the tab and the page agree.
export async function generateMetadata() {
  return dashboardMetadata("Settings.title")
}

/**
 * An operator's own settings, inside the console that account lives in.
 *
 * The twin of `/console/settings`, and it exists for the same reason: settings
 * used to be a single top-level path with a gate of its own, which is also what
 * made it the only page in either console that rendered without a sidebar. An
 * operator's account is per-account data like every other row in this sidebar,
 * so it is a row here, and the reader who follows it keeps the menu they were
 * reading.
 *
 * The gate is `app/[locale]/dashboard/layout.tsx`.
 */
export default function DashboardSettingsPage() {
  return (
    <DashboardLayout titleKey="Settings.title">
      <SettingsContent />
    </DashboardLayout>
  )
}
