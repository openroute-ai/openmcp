import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleApiKeysContent } from "@/components/api-keys/console-api-keys-content"
import { dashboardMetadata } from "@/components/dashboard-metadata"

export const dynamic = "force-dynamic"

export const generateMetadata = () => dashboardMetadata("ApiKeys.title")

/**
 * An account's own API keys.
 *
 * `dynamic` is forced for the same reason `/console` does: the list is scoped to
 * the session, so a cached render would hand one reader another account's keys.
 * The `/console` layout has already established that this reader is not an
 * admin; see `api-keys.ts` for why that is not what authorizes the mutations on
 * this page.
 */
export default function ConsoleApiKeysPage() {
  return (
    <ConsoleLayout titleKey="ApiKeys.title">
      <ConsoleApiKeysContent />
    </ConsoleLayout>
  )
}
