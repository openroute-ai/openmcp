import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleReposContent } from "@/components/console/console-repos-content"
import { dashboardMetadata } from "@/components/dashboard-metadata"

export const dynamic = "force-dynamic"

export const generateMetadata = () => dashboardMetadata("Console.title")

/**
 * The user console.
 *
 * One page, and the whole of what an account without the `admin` role may reach
 * — see `app/[locale]/console/layout.tsx` for the gate and
 * `adminProcedure` for what backs it up.
 */
export default function ConsolePage() {
  return (
    <ConsoleLayout titleKey="Console.title">
      <ConsoleReposContent />
    </ConsoleLayout>
  )
}
