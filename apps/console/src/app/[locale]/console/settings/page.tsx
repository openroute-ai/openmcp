import { ConsoleLayout } from "@/components/console/console-layout"
import { dashboardMetadata } from "@/components/dashboard-metadata"
import { SettingsContent } from "@/components/settings/settings-content"

export const dynamic = "force-dynamic"

export const generateMetadata = () => dashboardMetadata("Settings.title")

/**
 * An account's own settings, inside the console that account lives in.
 *
 * The twin of `/dashboard/settings`: the fields are the same and the content is
 * the same component, so the only thing this path decides is which sidebar the
 * reader gets and which layout gated them. `dynamic` is forced because every
 * field below is scoped to the session, so a cached render would hand one reader
 * another's account.
 *
 * The gate is `app/[locale]/console/layout.tsx`, which has already established
 * that this reader is not an admin; an admin who types this URL is sent to
 * `/dashboard` and can reach the same page at `/dashboard/settings`.
 */
export default function ConsoleSettingsPage() {
  return (
    <ConsoleLayout titleKey="Settings.title">
      <SettingsContent />
    </ConsoleLayout>
  )
}
