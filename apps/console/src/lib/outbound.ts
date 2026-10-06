/**
 * The console's own outbound link, for external targets.
 *
 * The public project page links out a lot — the repository, the author's
 * GitHub and social profiles, everything a README points at — and every one of
 * those used to point straight at the destination. That made the destinations
 * invisible: nobody could tell which external links get traffic, because the
 * browser jumped there without this site ever hearing about it.
 *
 * This module is the fix. An external target becomes a path on the console
 * itself (`/out`), and `/out` answers with a redirect to the real destination.
 * The click now lands here first, so it can be observed — and later counted —
 * before it leaves. It also keeps a reader on the site until they mean to
 * leave: the external target is not in the status bar until the redirect
 * fires.
 *
 * The rewrite is deliberately dialled down to strictest need:
 *
 *   - Only absolute `http(s)` URLs are rewritten. A `mailto:` or a relative
 *     link still points where it pointed — the console cannot usefully bounce
 *     the reader through itself to a protocol it does not speak.
 *   - Only valid URLs are rewritten. A malformed target is not a link worth
 *     counting, and bouncing one would hand an attacker a blank redirect.
 *
 * The route that consumes this is `[locale]/out/route.ts`. The path is left
 * unprefixed rather than localised on purpose: it is a redirect endpoint, not
 * a page, so whichever locale expresses it is irrelevant, and a prefix would
 * only add a hop for readers on the non-default locale.
 */

/** `/out?url=…` for an external target, or `null` when the target is not fit. */
export function outboundHref(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
  // `https://?` and `http:///path` parse without throwing but carry no host;
  // there is nobody to navigate to, so there is nothing for `/out` to bounce.
  if (!parsed.hostname) return null

  return `/out?url=${encodeURIComponent(url)}`
}