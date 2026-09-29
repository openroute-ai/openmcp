import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import type { TitleKey } from "@/components/dashboard-layout"

export const dynamic = "force-dynamic"

/**
 * The document metadata for a dashboard page.
 *
 * Next only calls this for a server component, and the tab title follows the
 * page's language, so it cannot be a static export.
 */
export async function dashboardMetadata(titleKey: TitleKey): Promise<Metadata> {
  const t = await getTranslations()
  return { title: t(titleKey) }
}
