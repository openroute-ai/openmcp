import type { Metadata } from "next"

import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { ProjectsFilterBar } from "@/components/public/projects-filter-bar"
import { PublicPagination } from "@/components/public/public-pagination"
import { PublicProjectBoard } from "@/components/public/public-project-list"
import { db } from "@/db/client"
import { siteTitle, siteUrl } from "@/lib/config/site"
import { clampPage, pageCount as pageCountOf } from "@/lib/pagination"
import {
  PROJECT_TYPE_LABELS,
  pageOf,
  parseProjectQuery,
  projectsQueryString,
} from "@/lib/public/project-filters"
import {
  countPublicProjectsForQuery,
  listPublicProjectFacets,
  listPublicProjects,
} from "@/lib/public/radar"
import { localizedPath } from "@/lib/seo/locale-path"

/**
 * The project catalog: every public project, filterable and sortable.
 *
 * Where the rankings answer "what moved" and the categories answer "what is
 * filed here", this page answers "show me the projects". It is the one place a
 * reader can combine the three curator's lenses — type, category, tag — with a
 * keyword search, and the three orders cover the readings a catalog is actually
 * read in: newest arrivals, stars, and the current week's gain.
 *
 * Paged on the server like the category pages, for their reasons: the catalog is
 * unbounded, and a crawler or an agent has to be able to cite page four by URL.
 * The filter state is the URL's query string, which is also why the form the
 * page renders submits to the same path — a shareable link is the whole point of
 * a state expressed as one.
 *
 * `force-dynamic` for the same reason the rankings are. The catalog reflects a
 * queue being curated continuously; a cached answer would be showing the shelf
 * as it stood before the latest arrival.
 */

export const dynamic = "force-dynamic"

/** How many projects one page holds — the same shelf size as the categories. */
const PAGE_SIZE = 20

export const metadata: Metadata = {
  title: siteTitle("项目库"),
  description:
    "按类型、分类与标签浏览全部公开项目，支持关键词搜索，可按最新入库、星数与增长最快排序。",
  alternates: { canonical: "/projects" },
  openGraph: {
    type: "website",
    title: siteTitle("项目库"),
    description: "按类型、分类与标签浏览全部公开项目。",
    url: siteUrl("/projects"),
  },
}

export default async function PublicProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ locale }, raw] = await Promise.all([params, searchParams])
  const query = parseProjectQuery(raw)

  // Counted before the rows are asked for: `?page=` is clamped against the total
  // *before* it becomes an offset, so a stale page lands on the last page that
  // exists instead of pushing Postgres an `OFFSET` past the end.
  const total = await countPublicProjectsForQuery(db, query)
  const pageCount = pageCountOf(total, PAGE_SIZE)
  const page = clampPage(pageOf(raw), pageCount)
  const offset = (page - 1) * PAGE_SIZE

  const [projects, facets] = await Promise.all([
    listPublicProjects(db, { ...query, limit: PAGE_SIZE, offset }),
    listPublicProjectFacets(db, query),
  ])

  const from = offset + 1
  const to = Math.min(offset + projects.length, total)
  const filtered = Boolean(query.q || query.type || query.category || query.tag)

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title="项目库"
          description="全部公开项目。可按类型、分类与标签筛选，支持关键词搜索；「增长最快」按最近完整一周的新增星标排序。"
        >
          <ProjectsFilterBar
            query={query}
            facets={facets}
            action={localizedPath(locale, "/projects")}
          />
        </PublicPageHeader>

        <div className="mt-6">
          <PublicProjectBoard
            groups={[
              {
                title: "全部项目",
                // The gain is only meaningful on the growth sort; on the other
                // two the column carries no period to attach a delta to.
                ...(query.sort === "growth" ? { deltaLabel: "本周增量" } : {}),
                emptyLabel: filtered
                  ? "没有符合当前筛选的项目。换个关键词，或清除筛选后再试。"
                  : "还没有公开项目。",
                // The two halves of a paged list: the heading says where in the
                // shelf these rows sit rather than counting the rows on screen.
                countLabel:
                  pageCount > 1
                    ? `第 ${from}–${to} 个，共 ${total} 个`
                    : undefined,
                startIndex: offset,
                items: projects.map((project) => ({
                  id: project.id,
                  owner: project.owner,
                  name: project.name,
                  fullName: project.fullName,
                  description: project.description,
                  stars: project.stars,
                  type:
                    PROJECT_TYPE_LABELS[
                      project.type as keyof typeof PROJECT_TYPE_LABELS
                    ] ?? project.type,
                  status: project.status,
                  tags: project.tags,
                  logo: project.logo,
                  avatar: project.avatar,
                  iconUrl: project.iconUrl,
                  ...(query.sort === "growth" && project.delta !== null
                    ? { delta: project.delta }
                    : {}),
                })),
              },
            ]}
          />
        </div>

        <PublicPagination
          page={page}
          pageCount={pageCount}
          href="/projects"
          search={projectsQueryString(query)}
        />
      </div>
    </PublicShell>
  )
}