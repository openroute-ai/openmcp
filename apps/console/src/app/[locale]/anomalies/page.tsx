import type { Metadata } from "next"

import { AnomalyList, GoodNewsList } from "@/components/public/anomaly-list"
import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { db } from "@/db/client"
import { ANOMALY_KINDS, type AnomalyKind } from "@/db/schema/github"
import { listOpenAnomalies } from "@/lib/radar/anomalies"
import Link from "next/link"

/**
 * The anomaly feed, as a page.
 *
 * Anonymous, and the reason it earns its own route is §5.9.4: a feed nobody can
 * link to is not a marketing surface, and a feed only an account can see is not
 * one either. It sits beside the rankings and reads from the same function as
 * `/api/anomalies.json`, so the page and the JSON cannot report different rows.
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
 */

export const dynamic = "force-dynamic"

/** How many rows the default view shows. A feed nobody scrolls past is a digest. */
const PAGE_LIMIT = 40

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
  title: "异动 — OpenMCP 雷达",
  description:
    "增速断崖、异常加速、维护停滞、推送停滞、许可证变更。每条异动附原始周数据与判定阈值，免费公开。",
  alternates: { canonical: "/anomalies" },
  openGraph: {
    type: "website",
    title: "异动 — OpenMCP 雷达",
    description:
      "增速断崖、异常加速、维护停滞、推送停滞、许可证变更。每条异动附原始周数据与判定阈值。",
    url: "https://radar.openmcp.cn/anomalies",
  },
}

export default async function PublicAnomaliesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  const params = await searchParams
  // Validated against the enum rather than trusted: an unknown value must fall
  // back to the full feed, not to an empty page. An empty page reads as "we
  // found nothing", which is a very different claim from "you typed the filter
  // wrong".
  const kind = ANOMALY_KINDS.find((candidate) => candidate === params.kind)

  const [anomalies, good] = await Promise.all([
    listOpenAnomalies(db, {
      limit: PAGE_LIMIT,
      kinds: kind ? [kind] : undefined,
    }),
    // The acceleration column is the one filter the default view excludes, so it
    // is fetched rather than derived from the main list.
    kind === undefined || kind === "star_acceleration"
      ? listOpenAnomalies(db, {
          limit: GOOD_LIMIT,
          kinds: ["star_acceleration"],
          includeGood: true,
        })
      : Promise.resolve([]),
  ])

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title="异动"
          description="按严重程度与绝对幅度排序。每一行都带触发它的那几个数，不需要相信我们的措辞。"
        >
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
          <AnomalyList
            anomalies={anomalies}
            emptyMessage={
              kind
                ? `没有检测到「${KIND_LABELS[kind]}」。`
                : "现在没有检测到异动。"
            }
          />

          {kind === undefined ? <GoodNewsList anomalies={good} /> : null}

          <p className="text-xs text-muted-foreground">
            数据截至{" "}
            {new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}{" "}
            · 判定与原始数据见 <code>/api/anomalies.json</code>
          </p>
        </div>
      </div>
    </PublicShell>
  )
}
