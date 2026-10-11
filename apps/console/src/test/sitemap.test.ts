/**
 * The sitemap's domain consistency.
 *
 * `vercelai.cn/sitemap.xml` and `www.vercelai.cn/sitemap.xml` are the same
 * route — the proxy's matcher lets any dotted last segment through, and
 * `sitemap.ts` builds every URL from `siteUrl()` rather than from the request —
 * so both hosts return the same document. What can still go wrong is the
 * document itself: one entry built from a different origin would make the two
 * halves of the site claim different canonical hosts, which is the duplicate-
 * content signal a sitemap exists to prevent.
 *
 * The database is mocked to nothing rather than queried: the entries derived
 * from categories and projects degrade to an empty list on any failure (the
 * route's own `try/catch` says so), and what is under test here is the URL
 * builder, not the catalogue.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/db/client", () => ({
  db: {
    selectDistinct: () => ({
      from: () => ({ where: async () => [] }),
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
        }),
      }),
    }),
  },
}))

import sitemap from "@/app/sitemap"
import { SITE_ORIGIN, siteUrl } from "@/lib/config/site"
import { INDEXABLE_PAGES } from "@/lib/seo/indexable-pages"

describe("sitemap", () => {
  it("builds every URL — entry and language alternate — on one origin", async () => {
    const entries = await sitemap()

    expect(entries.length).toBeGreaterThan(0)

    for (const entry of entries) {
      expect(new URL(entry.url).origin, entry.url).toBe(SITE_ORIGIN)
      for (const value of Object.values(entry.alternates?.languages ?? {})) {
        // Next types a language alternate as one URL or a list of them; both
        // shapes have to name the same origin.
        for (const href of Array.isArray(value) ? value : [value]) {
          expect(new URL(href).origin, href).toBe(SITE_ORIGIN)
        }
      }
    }
  })

  it("lists every indexable page in its default-locale spelling", async () => {
    const entries = await sitemap()
    const urls = new Set(entries.map((entry) => entry.url))

    for (const page of INDEXABLE_PAGES) {
      expect(urls.has(siteUrl(page.path)), page.path).toBe(true)
    }
  })

  it("keeps the canonical origin on the www host", () => {
    // Both hosts serve this route identically, so the host named *inside* the
    // document is the only one a crawler can treat as canonical. If this
    // assertion fails after a domain change, `.env.example` and
    // `.env.production` are the two places that must agree with it.
    expect(SITE_ORIGIN).toBe("https://www.vercelai.cn")
  })
})
