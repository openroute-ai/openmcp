/**
 * `GET /feed.xml` — the RSS 2.0 feed.
 *
 * Sits outside `[locale]` with the other machine routes; its dotted last
 * segment keeps it clear of the proxy's auth gate, so a subscriber polling
 * with no cookie gets the feed rather than a login redirect. `revalidate`
 * matches the sitemap's window: the anomaly stream moves at most daily, and
 * a subscriber refetching hourly is told about a hit from this morning by
 * tomorrow morning at the latest — while a build is never blocked on a
 * database that is briefly unreachable.
 */
import { feedEntries, renderRss } from "@/lib/seo/feed"

export const revalidate = 3600

export async function GET(): Promise<Response> {
  const entries = await feedEntries()

  return new Response(renderRss(entries), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  })
}
