/**
 * The RSS and Atom feeds.
 *
 * One entry list, two serialisations. The list is the anomaly feed first and
 * the blog second, because the thing on this site that *changes* is the
 * anomaly stream — a subscriber's reason to poll is "what broke this week",
 * and a feed that carried only posts would be the wrong instrument for the
 * one product surface the site has. Posts are included because they are also
 * updates, and a reader who subscribed once should not need a second
 * subscription for the occasional article.
 *
 * An anomaly's `link` goes to its project page rather than to `/anomalies`:
 * the stream page is a paginated view that reorders as new rows land, so an
 * entry that linked there would resolve to "some page that used to contain
 * this". The project page is stable, and the `#anomaly-<id>` fragment keeps
 * two hits on the same repository distinct as `guid` values — RSS clients
 * dedupe on `guid`, and two entries sharing one would silently drop the
 * second.
 *
 * The database is best-effort for the same reason the sitemap's queries are:
 * an outage downgrades the feed to the posts read from disk, which is a
 * thinner feed rather than a 500 on a URL a subscriber polls forever.
 */
import { listPosts } from "@/lib/blog"
import { db } from "@/db/client"
import { listOpenAnomalies } from "@/lib/radar/anomalies"
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/config/site"

/** Anomaly rows per feed. Twenty is one screen of the stream page. */
const ANOMALY_LIMIT = 20

/** Posts per feed. The archive is small and most of it is not "news". */
const POST_LIMIT = 10

export interface FeedEntry {
  title: string
  link: string
  /** Stable identity; RSS clients dedupe on this. */
  id: string
  date: Date
  summary: string
}

export async function feedEntries(): Promise<FeedEntry[]> {
  const posts = listPosts()
    .slice(0, POST_LIMIT)
    .map<FeedEntry>((post) => ({
      title: post.title,
      link: siteUrl(`/blog/${post.slug}`),
      id: siteUrl(`/blog/${post.slug}`),
      date: new Date(post.date),
      summary: post.excerpt,
    }))

  let anomalies: Awaited<ReturnType<typeof listOpenAnomalies>> = []
  try {
    anomalies = await listOpenAnomalies(db, { limit: ANOMALY_LIMIT })
  } catch {
    // Posts alone make a valid feed; throwing would make no feed at all.
  }

  const entries = [
    ...anomalies.map<FeedEntry>((row) => ({
      title: `${row.owner}/${row.name}：${row.title}`,
      link: siteUrl(`/projects/${row.owner}/${row.name}`),
      id: `${siteUrl(`/projects/${row.owner}/${row.name}`)}#anomaly-${row.id}`,
      date: row.detectedAt,
      summary:
        `${row.owner}/${row.name} 命中「${row.title}」（${row.kind}，severity=${row.severity}）` +
        `${row.stars === null ? "" : `，当前 ${row.stars} 星`}。` +
        `判定依据见项目页：${siteUrl(`/projects/${row.owner}/${row.name}`)}。`,
    })),
    ...posts,
  ]

  return entries.sort((a, b) => b.date.getTime() - a.date.getTime())
}

/* ───────────────────────────── XML plumbing ───────────────────────────── */

/**
 * XML text escaping.
 *
 * Anomaly titles are repository-derived strings and blog titles are typed by
 * a human; either can contain `&` or `<`, and an unescaped one produces a
 * feed that a strict parser rejects outright — worse than no feed, because a
 * subscriber whose first fetch 400s does not come back for the second.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

const FEED_TITLE = `${SITE_NAME} — 异动与更新`
const FEED_LINK = siteUrl("/anomalies")
const FEED_SELF = siteUrl("/feed.xml")

/** RSS 2.0, the format the larger share of subscribers still speaks. */
export function renderRss(entries: FeedEntry[]): string {
  const lastBuild = entries[0]?.date ?? new Date()

  const items = entries.map((entry) =>
    [
      "    <item>",
      `      <title>${escapeXml(entry.title)}</title>`,
      `      <link>${escapeXml(entry.link)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(entry.id)}</guid>`,
      `      <pubDate>${entry.date.toUTCString()}</pubDate>`,
      `      <description>${escapeXml(entry.summary)}</description>`,
      "    </item>",
    ].join("\n")
  )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(FEED_TITLE)}</title>`,
    `    <link>${escapeXml(FEED_LINK)}</link>`,
    `    <description>${escapeXml(SITE_DESCRIPTION)}</description>`,
    "    <language>zh-CN</language>",
    `    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(FEED_SELF)}" rel="self" type="application/rss+xml"/>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n")
}

/** Atom, for the readers that dropped RSS 0.9/2.0 and never took up 3.0. */
export function renderAtom(entries: FeedEntry[]): string {
  const updated = entries[0]?.date ?? new Date()

  const items = entries.map((entry) =>
    [
      "  <entry>",
      `    <title>${escapeXml(entry.title)}</title>`,
      `    <link href="${escapeXml(entry.link)}"/>`,
      `    <id>${escapeXml(entry.id)}</id>`,
      `    <updated>${entry.date.toISOString()}</updated>`,
      `    <summary>${escapeXml(entry.summary)}</summary>`,
      "  </entry>",
    ].join("\n")
  )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-CN">',
    `  <title>${escapeXml(FEED_TITLE)}</title>`,
    `  <subtitle>${escapeXml(SITE_DESCRIPTION)}</subtitle>`,
    `  <link href="${escapeXml(siteUrl("/atom.xml"))}" rel="self" type="application/atom+xml"/>`,
    `  <link href="${escapeXml(FEED_LINK)}" rel="alternate" type="text/html"/>`,
    `  <id>${escapeXml(siteUrl("/"))}</id>`,
    `  <updated>${updated.toISOString()}</updated>`,
    ...items,
    "</feed>",
    "",
  ].join("\n")
}
