import { DEFAULT_LOCALE, LOCALES } from "@/i18n/routing"
import { siteUrl } from "@/lib/config/site"

/**
 * A page's locale-prefixed path.
 *
 * The prefix rule is `localePrefix: "as-needed"`, so the default locale has no
 * prefix and every other one does. Handled here rather than with next-intl's
 * `getPathname` because the sitemap and `llms.txt` are generated outside a
 * request: there is no router there, and a helper that reaches for one would
 * either fail or, worse, silently emit unprefixed URLs for every locale.
 */
export function localizedPath(locale: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (locale === DEFAULT_LOCALE) return normalized
  // A prefixed root would be `/en/`, which is a different URL from `/en` and
  // would make the sitemap and the page disagree about the homepage.
  return normalized === "/" ? `/${locale}` : `/${locale}${normalized}`
}

/** Every locale this site serves, in the order the switcher shows them. */
export function allLocales(): string[] {
  return LOCALES
}

/**
 * The same page in every language, as a `languages` map for a sitemap entry.
 *
 * Absolute URLs, because this map is rendered as `xhtml:link href` and a
 * relative one is resolved by the crawler against whichever URL it happened to
 * fetch the sitemap from — fine for a single origin, silently wrong for a mirror
 * or a proxy.
 *
 * `x-default` points at the unprefixed path because that is what a crawler with
 * no language preference and no `Accept-Language` is served: the proxy rewrites
 * the bare path to the default locale, so the unprefixed URL is the one that
 * actually resolves to a document for every visitor.
 */
export function languageAlternates(path: string): Record<string, string> {
  const alternates: Record<string, string> = {}
  for (const locale of allLocales()) {
    alternates[locale] = siteUrl(localizedPath(locale, path))
  }
  alternates["x-default"] = siteUrl(path)
  return alternates
}
