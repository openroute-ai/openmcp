import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import type { TitleKey } from "@/components/app-shell"

export const dynamic = "force-dynamic"

/**
 * The document metadata for a page of either console.
 *
 * Next only calls this for a server component, and the tab title follows the
 * page's language, so it cannot be a static export. The title is a message path
 * rather than text, so the tab, the header and the sidebar all come from one
 * lookup and cannot drift apart.
 */
export async function dashboardMetadata(titleKey: TitleKey): Promise<Metadata> {
  const t = await getTranslations()
  return { title: t(titleKey) }
}
