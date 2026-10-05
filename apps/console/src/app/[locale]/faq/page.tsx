import type { Metadata } from "next"

import { siteTitle, siteUrl } from "@/lib/config/site"
import { FaqAccordion } from "@/components/faq/faq-accordion"
import { JsonLd } from "@/components/seo/json-ld"
import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { LocaleLink } from "@/i18n/navigation"
import { FAQS } from "@/lib/faq"
import { faqPageNode } from "@/lib/seo/structured-data"

/**
 * The FAQ as a page of its own, so the questions have a link worth pasting.
 *
 * The landing keeps its `#faq` section, because a reader who has just read the
 * copy should not have to navigate to get the answer; this exists for the other
 * case — the question arrives first, in a shared link or a search result, and
 * the reader lands on something that answers it instead of a marketing page
 * whose answer is somewhere below the fold.
 *
 * Dynamic rather than static, and the only public page that had to change for
 * this reason: the nav it shares with every other page resolves the session to
 * decide between "登录" and "进入控制台", and a prerendered page would bake one
 * answer into the HTML for all readers. That is the trade the rest of the public
 * surface already makes, so the FAQ makes it too rather than being the one page
 * whose nav disagrees with the others. The answers themselves still come from one
 * module, so the page and the landing page's `#faq` section cannot disagree.
 */

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: siteTitle("常见问题"),
  description: "数据从哪来、多久更新一次、怎么复核一条记录。",
  alternates: { canonical: "/faq" },
  openGraph: {
    type: "article",
    title: siteTitle("常见问题"),
    description: "数据从哪来、多久更新一次、怎么复核一条记录。",
    url: siteUrl("/faq"),
  },
}

export default function PublicFaqPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <PublicPageHeader title="常见问题" description="被问得最多的几个问题。">
          <LocaleLink
            href="/#faq"
            className="w-fit text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            ← 落地页上的常见问题
          </LocaleLink>
        </PublicPageHeader>

        <JsonLd node={faqPageNode(FAQS)} />

        <FaqAccordion items={FAQS} className="mt-8 space-y-3" />

        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          还有别的问题？榜单与生命体征数据可以通过 API 取：
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono">
            /api/v1/rankings/weekly
          </code>
          ，每条数字都能自己重算。
        </p>
      </div>
    </PublicShell>
  )
}
