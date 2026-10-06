import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleDashboardContent } from "@/components/console/console-dashboard-content"
import { dashboardMetadata } from "@/components/dashboard-metadata"

export const dynamic = "force-dynamic"

export const generateMetadata = () => dashboardMetadata("Console.dashboard")

/**
 * The user console's front page.
 *
 * What an account lands on after signing in: its own numbers and the history
 * chart behind them. The repository list it used to be is at `/console/repos` —
 * the same component, one level down, so "add a repository" and "how is my
 * account doing" stopped competing for one URL.
 *
 * The gate is `app/[locale]/console/layout.tsx` and the numbers are scoped to
 * the caller by `console.overview`; see that router for why they are not the
 * registry's counts.
 */
export default function ConsolePage() {
  return (
    <ConsoleLayout titleKey="Console.dashboard">
      <ConsoleDashboardContent />
    </ConsoleLayout>
  )
}