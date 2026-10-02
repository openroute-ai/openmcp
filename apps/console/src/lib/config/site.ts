/**
 * Who this site is: its name, its domain, and the absolute URLs that metadata
 * and copy need.
 *
 * This is the single source on purpose. The name and the origin used to be
 * typed inline, across 18 files — every `metadata.openGraph.url`, the header and
 * the footer, the eight legal pages, the `curl` sample in the API docs, the
 * newsletter subject and the mail sender. Changing the domain was therefore a
 * find-and-replace, and find-and-replace over metadata is exactly the kind of
 * edit that half-finishes: one missed `openGraph.url` leaves a canonical link
 * pointing at a host that no longer resolves, and search engines only find out
 * weeks later. Nothing user-visible spells the name or the domain any more.
 *
 * What deliberately does *not* live here:
 *
 *   - The Redis key prefix (`openmcp:console:`). It is an internal namespace, not
 *     a brand; renaming it would drop every in-flight rate-limit window and OTP
 *     code for no gain.
 *   - References to OpenMCP *other* apps. `OpenMCP` is the market's own brand
 *     (`apps/web`, `apps/api`, `apps/doc`); this site is not it, and the console
 *     only reads from those apps over HTTP without adopting their identity.
 */

/** Canonical origin. No trailing slash, because it is concatenated with paths. */
export const SITE_ORIGIN = "https://vercelai.cn"

/** Host alone, for the places that print the domain next to the wordmark. */
export const SITE_HOST = "vercelai.cn"

/** Chinese display name, and the `og:site_name` value. */
export const SITE_NAME = "AI雷达"

/** English display name, for `lang="en"` surfaces. */
export const SITE_NAME_EN = "AI Radar"

/**
 * The one-line pitch. Used verbatim as the footer blurb and as the OG
 * description, which is why it states the mechanism rather than the feeling —
 * it has to survive being read in a link preview with no context around it.
 */
export const SITE_TAGLINE =
  "记录 stargazer 的到达时间，判断开源项目正在变好还是变坏。"

/**
 * An absolute URL for a path on this site.
 *
 * `metadataBase` covers relative URLs in `<title>`-adjacent metadata, but not
 * the absolute `url` fields, and those are what get shared into other apps'
 * previews. Centralising them keeps the two halves from drifting.
 *
 * Accepts a leading slash, tolerates a missing one, and keeps the root path
 * slash-terminated (`SITE_ORIGIN` alone would serialise as
 * `https://vercelai.cn`, which some crawlers read as a file).
 */
export function siteUrl(path = "/"): string {
  if (!path) return `${SITE_ORIGIN}/`
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * A `<title>` for a page: the page's own subject, then the site.
 *
 * The separator lives here because it is part of the identity. The homepage is
 * the one place it is inverted — name first, then subject — and it does that
 * itself rather than through this helper.
 */
export function siteTitle(subject: string): string {
  return `${subject} — ${SITE_NAME}`
}
