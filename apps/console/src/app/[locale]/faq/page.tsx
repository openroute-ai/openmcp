import type { Metadata } from "next"

import { FaqAccordion } from "@/components/faq/faq-accordion"
import {
  PublicPageHeader,
  PublicShell,
} from "@/components/public/public-shell"
import { LocaleLink } from "@/i18n/navigation"
import { FAQS } from "@/lib/faq"

/**
 * The FAQ as a page of its own, so the questions have a link worth pasting.
 *
 * The landing keeps its `#faq` section, because a reader who has just read the
 * copy should not have to navigate to get the answer; this exists for the other
 * case — the question arrives first, in a shared link or a search result, and
 * the reader lands on something that answers it instead of a marketing page
 * whose answer is somewhere below the fold.
 *
 * Static rather than `force-dynamic`, and the only public page that is: there is
 * no per-reader state in a list of answers, so re-rendering it on every request
 * would spend a database-free render on producing the same bytes. The answers
 * come from one module, so a page and a section cannot disagree.
 */

export const dynamic = "force-static"

export const metadata: Metadata = {
  title: "常见问题 — OpenMCP 雷达",
  description:
    "数据从哪来、多久更新一次、怎么复核一条记录。",
  alternates: { canonical: "/faq" },
  openGraph: {
    type: "article",
    title: "常见问题 — OpenMCP 雷达",
    description:
      "数据从哪来、多久更新一次、怎么复核一条记录。",
    url: "https://radar.openmcp.cn/faq",
  },
}

export default function PublicFaqPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <PublicPageHeader
          title="常见问题"
          description="被问得最多的几个问题。"
        >
          <LocaleLink
            href="/#faq"
            className="w-fit text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            ← 落地页上的常见问题
          </LocaleLink>
        </PublicPageHeader>

        <FaqAccordion items={FAQS} className="mt-8 space-y-3" />

        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          还有别的问题？榜单与生命体征数据可以直接取 JSON：
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono">
            /api/rankings/week.json
          </code>
          ，每条数字都能自己重算。
        </p>
      </div>
    </PublicShell>
  )
}
