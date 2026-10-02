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
 * Every value here is read from the environment first and falls back to the
 * constants below. That fallback is what makes this file a *configuration* rather
 * than a constant table: a fork, a staging deployment or a rebrand changes
 * `NEXT_PUBLIC_SITE_*` in one place instead of editing source, and the defaults
 * are the deployed brand so an unconfigured build behaves exactly as it does
 * today. The name and the domain are read together because they are one fact —
 * a wordmark printed next to a host that belongs to a different brand is the
 * half-finished edit this file exists to prevent.
 *
 * The variables are `NEXT_PUBLIC_*` because the header, the footer and the site
 * mark are client components: a private variable would build fine and then render
 * as `undefined` in the browser. They are read through one frozen object literal
 * with static property access on purpose — Next inlines `NEXT_PUBLIC_*` by
 * replacing the literal member access at build time, so a computed lookup like
 * `process.env[name]` silently resolves to `undefined` in the client bundle.
 *
 * What deliberately does *not* live here:
 *
 *   - The Redis key prefix (`openmcp:console:`). It is an internal namespace, not
 *     a brand; renaming it would drop every in-flight rate-limit window and OTP
 *     code for no gain.
 *   - References to OpenMCP *other* apps. `OpenMCP` is the market's own brand
 *     (`apps/web`, `apps/api`, `apps/doc`); this site is not it, and the console
 *     only reads from those apps over HTTP without adopting their identity. The
 *     one exception is {@link DOCS_ORIGIN}, which is the host this site links
 *     *out* to for the long-form API reference — a destination, not an identity.
 */

/**
 * Reads the brand variables.
 *
 * A property read, not an indexed one: Next replaces `process.env.NEXT_PUBLIC_X`
 * with the literal at build time and has nothing to replace in `process.env[x]`.
 * An empty string counts as unset, because an empty `.env` line is the shape a
 * deploy gets when a secret manager writes an unset value.
 */
const ENV = {
  origin: process.env.NEXT_PUBLIC_SITE_ORIGIN,
  host: process.env.NEXT_PUBLIC_SITE_HOST,
  name: process.env.NEXT_PUBLIC_SITE_NAME,
  nameEn: process.env.NEXT_PUBLIC_SITE_NAME_EN,
  tagline: process.env.NEXT_PUBLIC_SITE_TAGLINE,
  description: process.env.NEXT_PUBLIC_SITE_DESCRIPTION,
  github: process.env.NEXT_PUBLIC_SITE_GITHUB_URL,
  docs: process.env.NEXT_PUBLIC_SITE_DOCS_ORIGIN,
} as const

function fromEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Drops a trailing slash and rejects anything that is not an absolute origin.
 *
 * The value is concatenated with paths, so a trailing slash would produce
 * `https://host//docs` — a URL that resolves, which is why nothing complains
 * about it, but a canonical link that differs from the one every internal link
 * uses is exactly the duplicate-content signal a sitemap is meant to avoid.
 *
 * An unparseable value falls back to the default rather than throwing: a typo in
 * a build variable should not take down every page that renders metadata, and a
 * wrong-but-served origin is still better than a 500 during a deploy.
 */
function toOrigin(value: string | undefined, fallback: string): string {
  const candidate = fromEnv(value)
  if (!candidate) return fallback
  try {
    return new URL(candidate).origin
  } catch {
    return fallback
  }
}

/** Canonical origin. No trailing slash, because it is concatenated with paths. */
export const SITE_ORIGIN = toOrigin(ENV.origin, "https://vercelai.cn")

/**
 * Host alone, for the places that print the domain next to the wordmark.
 *
 * Derived from the origin rather than configured separately, so it cannot drift
 * from the URL the canonical links point at. `SITE_HOST` stays overridable for
 * the one case the origin cannot express: a deployment served from a bare host
 * that the canonical origin deliberately does not name.
 */
export const SITE_HOST = fromEnv(ENV.host) ?? new URL(SITE_ORIGIN).host

/** Chinese display name, and the `og:site_name` value. */
export const SITE_NAME = fromEnv(ENV.name) ?? "AI雷达"

/** English display name, for `lang="en"` surfaces. */
export const SITE_NAME_EN = fromEnv(ENV.nameEn) ?? "AI Radar"

/**
 * The one-line pitch. Used verbatim as the footer blurb and as the OG
 * description, which is why it states the mechanism rather than the feeling —
 * it has to survive being read in a link preview with no context around it.
 */
export const SITE_TAGLINE =
  fromEnv(ENV.tagline) ??
  "记录 stargazer 的到达时间，判断开源项目正在变好还是变坏。"

/**
 * The one-paragraph description.
 *
 * Distinct from the tagline on purpose: the tagline is a slogan that has to fit
 * on one line next to a wordmark, while this is the sentence that goes into
 * `meta[name=description]`, into the JSON-LD `WebSite` node and into the first
 * lines of `/llms.txt`. A shortened slogan in a search result reads as a
 * non-answer, and an answer engine quoting a slogan as the site's description
 * is worse than quoting nothing.
 */
export const SITE_DESCRIPTION =
  fromEnv(ENV.description) ??
  "AI雷达记录每个 stargazer 到达 GitHub 的时间，据此判断一个开源项目正在变好还是变坏。周榜、月榜、年度飙升榜与异动流都以原始星标增量、相对增速和维护停滞证据对外提供，每条结论都能点开复核。"

/** The repository the footer links to, and the one `sameAs` should name. */
export const SITE_GITHUB_URL =
  fromEnv(ENV.github) ?? "https://github.com/openroute-ai/openmcp"

/**
 * The long-form documentation host.
 *
 * This site's own `/docs` page documents the four anonymous JSON endpoints in
 * full, because those are the endpoints a reader can call without an account.
 * Everything else this app serves — the ingest API, the scheduler, the skill
 * export, the API-key credentials — is written up here, because it is a
 * different audience on a different site and mixing the two would put
 * `CRON_SECRET` instructions in a page a crawler indexes next to a signup form.
 */
export const DOCS_ORIGIN = toOrigin(ENV.docs, "https://openmcp.org")

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

/** An absolute URL on the long-form documentation host. */
export function docsUrl(path = "/"): string {
  return `${DOCS_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`
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
