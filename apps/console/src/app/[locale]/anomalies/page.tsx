import type { Metadata } from "next"

import { siteTitle, siteUrl } from "@/lib/config/site"
import { AnomalyList, GoodNewsList } from "@/components/public/anomaly-list"
import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { PublicPagination } from "@/components/public/public-pagination"
import { db } from "@/db/client"
import { ANOMALY_KINDS, type AnomalyKind } from "@/db/schema/github"
import { LocaleLink } from "@/i18n/navigation"
import { clampPage, pageCount as pageCountOf } from "@/lib/pagination"
import {
  countOpenAnomalies,
  listOpenAnomalies,
  type OpenAnomalyScope,
} from "@/lib/radar/anomalies"
import Link from "next/link"

/**
 * The anomaly feed, as a page.
 *
 * Anonymous, and the reason it earns its own route is §5.9.4: a feed nobody can
 * link to is not a marketing surface, and a feed only an account can see is not
 * one either. It is the only public rendering of `listOpenAnomalies`, so there is
 * no second copy of the feed that could report different rows.
 *
 * `force-dynamic` for the same reason the rankings are. A reader who lands here
 * during a project's decline is reading this page *because* it is current; a
 * cached feed would still be showing last week's answer to the question that
 * brought them here, and would look like a correct answer.
 *
 * The "healthy acceleration" column is rendered from the same table as the
 * alerts. It is not decoration: §5.4's third red line is that a signal station
 * has to be able to show its alerts are selective, and a reader given only the
 * down column has no way to do that.
 *
 * Paged on the server, and paged by URL, for the reason `categories/[tag]` is:
 * unlike a category this feed has no promise of completeness — but unlike a
 * category it has no editorial ceiling either, and a repository that fires every
 * week keeps adding rows to a feed that was already further than anyone scrolls.
 * An `OFFSET` over a growing table also costs more the deeper the reader goes,
 * so the last page is the expensive one and it is the one nobody reads.
 */

export const dynamic = "force-dynamic"

/**
 * How many rows one page holds.
 *
 * 40 rather than a round 20 because a row is not one line: each carries its title,
 * a severity band and an expandable evidence series, so twenty of them is already
 * a long page. The number is a compromise between "there is enough here that page
 * two is worth a control" and "one page is one scroll" — the same compromise
 * `PAGE_LIMIT` was making implicitly when the feed had no pages at all.
 */
const PAGE_SIZE = 40

/** The "we report good news too" column gets its own, smaller budget. */
const GOOD_LIMIT = 5

const KIND_LABELS: Record<AnomalyKind, string> = {
  star_cliff: "增速断崖",
  star_acceleration: "异常加速",
  release_stall: "维护停滞",
  commit_stall: "推送停滞",
  license_change: "许可证变更",
}

const FILTERS = [
  { value: "all", label: "全部" },
  ...ANOMALY_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
] as const

export const metadata: Metadata = {
  title: siteTitle("异动"),
  description: "最近一周发生变化的开源项目：涨得快、跌得快、停更、换了许可证。",
  alternates: { canonical: "/anomalies" },
  openGraph: {
    type: "website",
    title: siteTitle("异动"),
    description: "最近一周发生变化的开源项目。",
    url: siteUrl("/anomalies"),
  },
}

export default async function PublicAnomaliesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; page?: string }>
}) {
  const params = await searchParams
  // Validated against the enum rather than trusted: an unknown value must fall
  // back to the full feed, not to an empty page. An empty page reads as "we
  // found nothing", which is a very different claim from "you typed the filter
  // wrong".
  const kind = ANOMALY_KINDS.find((candidate) => candidate === params.kind)

  // One scope, handed to both the count and the page query, so the total the
  // reader is shown and the rows they are shown are the same question asked once.
  const scope: OpenAnomalyScope = { kinds: kind ? [kind] : undefined }

  // Counted before the rows are asked for, not derived from them: the page has
  // to be clamped against the total *before* it becomes an offset, or `?page=9`
  // against a four-page feed asks Postgres past the end, gets nothing back, and
  // renders a page claiming to be the ninth of an empty list.
  const total = await countOpenAnomalies(db, scope)

  const pageCount = pageCountOf(total, PAGE_SIZE)
  const page = clampPage(params.page, pageCount)
  const offset = (page - 1) * PAGE_SIZE

  const [anomalies, good] = await Promise.all([
    listOpenAnomalies(db, { ...scope, limit: PAGE_SIZE, offset }),
    // The acceleration column is the one filter the default view excludes, so it
    // is fetched rather than derived from the main list — and only for the
    // unfiltered view, which is the only one that renders it. Page one only,
    // because it is an aside about the feed rather than a slice of it: repeating
    // the same five rows at the top of every page would be decoration by another
    // name.
    kind === undefined && page === 1
      ? listOpenAnomalies(db, {
          limit: GOOD_LIMIT,
          kinds: ["star_acceleration"],
          includeGood: true,
        })
      : Promise.resolve([]),
  ])

  const from = offset + 1
  const to = offset + anomalies.length

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader title="异动" description="最近一周发生变化的项目。">
          <nav className="flex flex-wrap gap-1.5 text-sm">
            {FILTERS.map((filter) => {
              const active =
                filter.value === "all" ? !kind : kind === filter.value
              return (
                <Link
                  key={filter.value}
                  href={
                    filter.value === "all"
                      ? "/anomalies"
                      : `/anomalies?kind=${filter.value}`
                  }
                  className={
                    active
                      ? "rounded-lg bg-accent px-2.5 py-1 font-medium text-accent-foreground"
                      : "rounded-lg px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  }
                >
                  {filter.label}
                </Link>
              )
            })}
          </nav>
        </PublicPageHeader>

        <div className="grid gap-6 pt-6">
          {/* Where in the feed this page sits. Silent on a single-page feed
              because "第 1–12 条，共 12 条" only says the obvious, and the
              obvious on every visit is noise. */}
          {pageCount > 1 ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              第 {from}–{to} 条，共 {total.toLocaleString("en-US")} 条
            </p>
          ) : null}

          <AnomalyList
            anomalies={anomalies}
            emptyMessage={
              kind
                ? `没有检测到「${KIND_LABELS[kind]}」。`
                : "现在没有检测到异动。"
            }
          />

          {kind === undefined ? <GoodNewsList anomalies={good} /> : null}

          <PublicPagination
            page={page}
            pageCount={pageCount}
            href="/anomalies"
            // The filter rides on every page link, so paging within a filter
            // stays inside it. The filter links above deliberately do *not* carry
            // the page: switching filters has to land on the top of the new
            // list, never on page 7 of it.
            params={kind ? { kind } : undefined}
          />

          <p className="text-xs text-muted-foreground">
            数据截至{" "}
            {new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}{" "}
            · 判定规则与阈值见{" "}
            <LocaleLink href="/method" className="underline underline-offset-2">
              判定规则
            </LocaleLink>
          </p>
        </div>
      </div>
    </PublicShell>
  )
}
