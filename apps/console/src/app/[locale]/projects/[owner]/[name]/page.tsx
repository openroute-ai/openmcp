import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PublicStarTrend } from "@/components/public/public-star-trend"
import { PublicShell } from "@/components/public/public-shell"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import { getPublicProjectDetail } from "@/lib/public/radar"

/**
 * One project's public detail: identity, the numbers, and the day/week chart.
 *
 * Anonymous, and 404 for anything an editor hid. The page is `force-dynamic`
 * because the numbers on it are the product — a cached detail page would report
 * a repository's stargazer count as of whenever it happened to be rendered.
 *
 * Every figure here is a recorded count, never a derived score. There is no
 * "how healthy is this project" number, because a composite score is the thing
 * this product is built to be able to disprove: the timestamps are published so
 * a reader can recompute any conclusion instead of trusting ours.
 */

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; name: string }>
}): Promise<Metadata> {
  const { owner, name } = await params
  const project = await getPublicProjectDetail(db, owner, name)

  if (!project) return { title: "项目不存在" }

  return {
    title: `${project.fullName} — OpenMCP 雷达`,
    description: project.description || `${project.fullName} 的星标增长与公开数据。`,
    alternates: { canonical: `/projects/${project.owner}/${project.name}` },
    openGraph: {
      type: "website",
      title: `${project.fullName} — OpenMCP 雷达`,
      description: project.description,
    },
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export default async function PublicProjectPage({
  params,
}: {
  params: Promise<{ locale: string; owner: string; name: string }>
}) {
  const { owner, name } = await params
  const project = await getPublicProjectDetail(db, owner, name)

  if (!project) notFound()

  const daysGained = project.days.reduce((sum, day) => sum + day.stars, 0)
  const facts: [string, string][] = [
    ["星标", project.stars.toLocaleString("en-US")],
    ["最近 90 天新增", daysGained.toLocaleString("en-US")],
    ["Fork", project.forks.toLocaleString("en-US")],
    ["贡献者", project.contributors?.toLocaleString("en-US") ?? "未记录"],
    ["发布", project.releases.toLocaleString("en-US")],
    ["许可证", project.license ?? "未记录"],
    ["主语言", project.language ?? "未记录"],
    ["最近推送", formatDate(project.pushedAt)],
    ["建库", formatDate(project.createdAt)],
  ]

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-3 border-b border-border pb-6">
          <LocaleLink href="/rankings" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            ← 返回公开榜单
          </LocaleLink>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {project.fullName}
            </h1>
            {project.status === "deprecated" && (
              <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                已弃用
              </span>
            )}
          </div>
          {project.description && (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {project.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {project.url && (
              <a
                href={project.url}
                rel="noopener noreferrer nofollow"
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                打开仓库
              </a>
            )}
            {project.tags.map((tag) => (
              <LocaleLink
                key={tag}
                href={`/categories/${tag}`}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {tag}
              </LocaleLink>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <PublicStarTrend
            days={project.days}
            weeks={project.weeks}
            hasWeeklyHistory={project.weeks.length > 0}
          />

          <dl className="grid content-start gap-px overflow-hidden rounded-xl border border-border bg-border text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 bg-background px-4 py-2.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
          页面上的每个数字都来自记录下来的 stargazer 到达时间，没有评分公式，也没有 AI 判定。
          任何结论都可以用 <code className="rounded bg-muted px-1 py-0.5 font-mono">/api/rankings/week.json</code>{" "}
          里的原始增量自己重算。
        </p>
      </div>
    </PublicShell>
  )
}
