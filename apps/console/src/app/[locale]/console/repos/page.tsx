import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleReposContent } from "@/components/console/console-repos-content"
import { dashboardMetadata } from "@/components/dashboard-metadata"

export const dynamic = "force-dynamic"

export const generateMetadata = () => dashboardMetadata("Console.title")

/**
 * The repositories this account submitted.
 *
 * Moved off `/console` rather than copied there, so the path a repository's
 * detail page is reached from (`/console/repos/[id]`, which already existed) has
 * a list above it. Both URLs render this same component.
 */
export default function ConsoleReposPage() {
  return (
    <ConsoleLayout titleKey="Console.title">
      <ConsoleReposContent />
    </ConsoleLayout>
  )
}