/**
 * The site's own name in one language, for structured data.
 *
 * A JSON-LD node is read by a machine, not rendered, so it cannot ask the reader
 * which language they picked — and `WebSite` / `Organization` live in the root
 * layout, where the one thing that *is* known is the document's `lang`. Without
 * this, every English page would announce itself to a crawler as the Chinese
 * name, and an answer engine asked "what is AI Radar" would have to reconcile
 * two spellings of the same site.
 */

import { SITE_NAME, SITE_NAME_EN } from "@/lib/config/site"

export function siteNameForLocale(locale: string): string {
  return locale === "en" ? SITE_NAME_EN : SITE_NAME
}
