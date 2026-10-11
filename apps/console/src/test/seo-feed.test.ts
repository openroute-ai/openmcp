/**
 * The feed serialisations and the subscribe skill.
 *
 * Two things a machine reads that no page renders: XML that has to parse on
 * the first fetch (a subscriber whose initial poll 400s does not retry), and
 * a skill that names channels and endpoints the site must actually have. The
 * skill is a pure read — no database — so it is tested here rather than
 * through the endpoint.
 */
import { describe, expect, it } from "vitest"

import {
  escapeXml,
  renderAtom,
  renderRss,
  type FeedEntry,
} from "@/lib/seo/feed"
import { readSubscriptions } from "@/lib/agent/skills"
import { SITE_ORIGIN } from "@/lib/config/site"

const ENTRIES: FeedEntry[] = [
  {
    title: "vercel/next.js：新增 star 明显加速",
    link: "https://www.vercelai.cn/projects/vercel/next.js",
    id: "https://www.vercelai.cn/projects/vercel/next.js#anomaly-abc",
    date: new Date("2026-10-01T12:00:00Z"),
    summary: "命中「新增 star 明显加速」（acceleration，severity=notice）。",
  },
  {
    title: "为什么不做综合评分 & 什么是断崖",
    link: "https://www.vercelai.cn/blog/no-composite-score",
    id: "https://www.vercelai.cn/blog/no-composite-score",
    date: new Date("2026-09-20T00:00:00Z"),
    summary: "分数主要由 star 数决定。",
  },
]

describe("escapeXml", () => {
  it("escapes every character that would end an element early", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f"
    )
  })
})

describe("renderRss", () => {
  const xml = renderRss(ENTRIES)

  it("is a well-formed rss document with one item per entry", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain("<channel>")
    expect(xml.match(/<item>/g)).toHaveLength(ENTRIES.length)
    expect(xml.trimEnd().endsWith("</rss>")).toBe(true)
  })

  it("leaves no raw ampersand outside an entity", () => {
    expect(xml).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+);)/)
  })

  it("keeps guids distinct so a client can dedupe", () => {
    const guids = [...xml.matchAll(/<guid[^>]*>(.*?)<\/guid>/g)].map(
      (m) => m[1]
    )
    expect(guids).toHaveLength(ENTRIES.length)
    expect(new Set(guids).size).toBe(ENTRIES.length)
  })

  it("carries the channel self-link for feed readers that rewrite it", () => {
    expect(xml).toContain(
      `<atom:link href="${SITE_ORIGIN}/feed.xml" rel="self" type="application/rss+xml"/>`
    )
  })
})

describe("renderAtom", () => {
  const xml = renderAtom(ENTRIES)

  it("is a feed with one entry per item and ISO timestamps", () => {
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"')
    expect(xml.match(/<entry>/g)).toHaveLength(ENTRIES.length)
    expect(xml).toContain("<updated>2026-10-01T12:00:00.000Z</updated>")
    expect(xml.trimEnd().endsWith("</feed>")).toBe(true)
  })

  it("escapes entry text the same way RSS does", () => {
    expect(xml).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+);)/)
  })
})

describe("readSubscriptions", () => {
  const answer = readSubscriptions()
  const data = answer.data as {
    feeds: { url: string }[]
    a2aPush: { supported: boolean }
    apiKeyOperations: { method: string; path: string; scope: string }[]
  }

  it("names both feeds without claiming any push capability", () => {
    expect(data.feeds.map((feed) => feed.url)).toEqual([
      `${SITE_ORIGIN}/feed.xml`,
      `${SITE_ORIGIN}/atom.xml`,
    ])
    // The card says pushNotifications: false; a skill promising push would
    // contradict the card in the same response.
    expect(data.a2aPush.supported).toBe(false)
  })

  it("lists the key-gated write and subscription operations, not the reads", () => {
    expect(data.apiKeyOperations.length).toBeGreaterThan(0)
    for (const operation of data.apiKeyOperations) {
      expect(operation.scope).not.toBe("")
      expect(operation.path.startsWith("/api/v1/")).toBe(true)
    }
    const paths = data.apiKeyOperations.map((operation) => operation.path)
    expect(paths).toContain("/api/v1/subscriptions")
    expect(paths).toContain("/api/v1/repos")
    // Reads are reachable anonymously through this very endpoint; quoting
    // the keyed read endpoints here would say the opposite.
    expect(paths).not.toContain("/api/v1/rankings/weekly")
  })
})
