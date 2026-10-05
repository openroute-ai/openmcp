import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { siteTitle } from "@/lib/config/site"
import { ProjectLogo } from "@/components/projects/project-logo"
import { EvidenceTimeline } from "@/components/public/evidence-timeline"
import { PublicAuthorCard } from "@/components/public/public-author-card"
import { PublicReadme } from "@/components/public/public-readme"
import { PublicRelatedProjects } from "@/components/public/public-related-projects"
import { PublicShell } from "@/components/public/public-shell"
import { PublicStarTrend } from "@/components/public/public-star-trend"
import { VitalsStrip } from "@/components/public/vitals-strip"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import {
  getPublicAuthor,
  getPublicProjectDetail,
  getPublicProjectIdentity,
  listRelatedPublicProjects,
} from "@/lib/public/radar"
import { readTimeline } from "@/lib/radar/timeline"
import { readVitals } from "@/lib/radar/vitals"

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
  // The identity read, not the detail read: the title needs four columns, and
  // asking for the charts here meant every page view fetched the 90-day series
  // twice — once for metadata, once for the body. See `getPublicProjectIdentity`.
  const project = await getPublicProjectIdentity(db, owner, name)

  if (!project) return { title: "项目不存在" }

  return {
    title: siteTitle(`${project.fullName}`),
    description:
      project.description || `${project.fullName} 的星标增长与公开数据。`,
    alternates: { canonical: `/projects/${project.owner}/${project.name}` },
    openGraph: {
      type: "website",
      title: siteTitle(`${project.fullName}`),
      description: project.description ?? undefined,
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
  const { locale, owner, name } = await params
  const project = await getPublicProjectDetail(db, owner, name)

  if (!project) notFound()

  // The author is the repository's owner, and the related projects are whatever
  // else is tagged the same way. Both are independent of the detail read, so
  // they are fetched alongside it rather than after it renders. The vitals and
  // the timeline are in the same batch because they read the same repository and
  // this page is already `force-dynamic` — a second waterfall would double the
  // time to first paint of the numbers, which are the point of the page.
  const [author, related, vital, timeline] = await Promise.all([
    getPublicAuthor(db, project.owner),
    listRelatedPublicProjects(db, {
      projectId: project.id,
      tagCodes: project.tags,
    }),
    readVitals(db, {
      id: project.repoId,
      pushedAt: project.pushedAt,
      latestReleasePublishedAt: project.latestReleasePublishedAt,
      licenseSpdxId: project.license,
    }),
    readTimeline(db, project.repoId, { limit: 20 }),
  ])

  // Days no writer measured are left out of the sum rather than counted as
  // zero, so a repository the collectors have not reached reads as "未记录" and
  // not as "nobody starred it in ninety days".
  const measuredDays = project.days.filter((day) => day.stars !== undefined)
  const daysGained =
    measuredDays.length > 0
      ? measuredDays
          .reduce((sum, day) => sum + (day.stars ?? 0), 0)
          .toLocaleString("en-US")
      : "未记录"
  const facts: [string, string][] = [
    ["星标", project.stars.toLocaleString("en-US")],
    ["最近 90 天新增", daysGained],
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
          <LocaleLink
            href="/rankings"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            ← 返回公开榜单
          </LocaleLink>
          <div className="flex flex-wrap items-center gap-3">
            <ProjectLogo
              name={project.name}
              logo={project.logo}
              avatar={project.avatar}
              iconUrl={project.iconUrl}
              className="size-10"
            />
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
          <div className="flex min-w-0 flex-col gap-8 self-start">
            {/* The vitals strip, above the chart, because it answers "is this
                project ok" in one line and the chart only answers it after you
                have read a shape. Neither replaces the other: the strip is
                current readings, the chart is the series behind them. */}
            <VitalsStrip vital={vital} />

            <PublicStarTrend
              days={project.days}
              weeks={project.weeks}
              hasWeeklyHistory={project.weeks.length > 0}
            />

            {/* Rendered whether or not a README is stored, rather than only when
                one is: a project with no README yet is a normal state (the sync
                that fetches it has not run), and hiding the whole section makes
                the page indistinguishable from one where the reader simply forgot
                to look. The card states the missing README instead of leaving a
                gap where one should be. */}
            {/* The timeline keeps dismissed rows (§5.4 red line 2 needs the
                context, and `EvidenceTimeline` marks them). It sits below the
                README because it is reference material: a reader looking for
                how to use this project should not have to scroll past our
                conclusions first. */}
            <section className="grid gap-3">
              <h2 className="font-display text-lg font-semibold tracking-tight">
                证据时间轴
              </h2>
              <EvidenceTimeline events={timeline} />
            </section>

            <PublicReadme
              readme={project.readme}
              readmeZh={project.readmeZh}
              locale={locale}
            />
          </div>

          <aside className="grid min-w-0 content-start gap-4">
            <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border text-sm">
              {facts.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-3 bg-background px-4 py-2.5"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <PublicAuthorCard author={author} />
            <PublicRelatedProjects projects={related} />
          </aside>
        </div>

        <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
          页面上的每个数字都来自记录下来的 stargazer
          到达时间，没有评分公式，也没有 AI 判定。 任何结论都可以用{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">
            /api/v1/repos/{"{id}"}/stats
          </code>{" "}
          里的原始增量自己重算。
        </p>
      </div>
    </PublicShell>
  )
}
