import { notFound } from "next/navigation"

import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { PublicProjectBoard } from "@/components/public/public-project-list"
import { PublicPagination } from "@/components/public/public-pagination"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import { getTagByCode } from "@/lib/github/service/tag"
import { clampPage, pageCount as pageCountOf } from "@/lib/pagination"
import {
  countPublicProjectsByTag,
  listPublicProjectsByTag,
} from "@/lib/public/radar"

/**
 * One category's projects, one page at a time.
 *
 * A tag that exists but is excluded from rankings answers 404 here, the same as
 * a tag that does not exist: the category nav never links to it, so reaching the
 * URL means guessing, and a page that answers "this exists, you just may not
 * browse it" is a worse answer than a 404 for anyone probing.
 *
 * The list is ordered by stars rather than by a period delta, because a category
 * is a shelf, not a ranking — the rankings page is where movement is the point.
 *
 * Paged on the server, and paged by URL. A category is the one public list with no
 * editorial ceiling: the promise of a shelf is that everything filed under it is
 * reachable, so the alternative to a page break is a response that grows with the
 * tag — and `mcp-server` alone already runs to hundreds of rows, all of which were
 * being rendered into one document for a reader who wanted the first twenty.
 * `?page=` rather than a client-side slice for the reason the controls are links
 * at all: this page is reached by shared links and read by crawlers and agents,
 * and none of them would ever find page four without a URL to ask for.
 */

export const dynamic = "force-dynamic"

/**
 * How many projects one page holds.
 *
 * Enough that browsing a category does not feel like clicking through an archive,
 * few enough that the list view stays a single scroll and the star ordering can
 * be held in the head while reading it. The public pages are capped at `max-w-6xl`
 * and the rows are one line each, so twenty is also roughly one screen of the
 * board as it is laid out.
 */
const PAGE_SIZE = 20

export default async function PublicTagPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; tag: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const [{ tag: code }, query] = await Promise.all([params, searchParams])

  const tag = await getTagByCode(db, code)
  if (!tag || tag.excludeFromRankings) notFound()

  // Counted before the rows are asked for, not derived from them. The requested
  // page has to be clamped against the total *before* it becomes an offset:
  // `?page=40` against a three-page shelf would otherwise ask Postgres for an
  // offset past the end, get nothing back, and render a page claiming to be page
  // 40 of an empty list. One indexed aggregate buys a correct answer to a URL
  // anyone can type.
  const total = await countPublicProjectsByTag(db, code)
  const pageCount = pageCountOf(total, PAGE_SIZE)
  const page = clampPage(query.page, pageCount)
  const offset = (page - 1) * PAGE_SIZE

  const projects = await listPublicProjectsByTag(db, code, {
    limit: PAGE_SIZE,
    offset,
  })

  const from = offset + 1
  const to = Math.min(offset + projects.length, total)

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title={tag.name}
          description={tag.description ?? `分类代码 ${tag.code}`}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <LocaleLink
              href="/categories"
              className="hover:text-foreground hover:underline"
            >
              ← 全部分类
            </LocaleLink>
            <span>·</span>
            <span>共 {total.toLocaleString("en-US")} 个项目</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {tag.code}
            </code>
          </div>
        </PublicPageHeader>

        <div className="mt-6">
          <PublicProjectBoard
            groups={[
              {
                title: "全部项目",
                periodLabel: tag.code,
                emptyLabel: "这个分类下还没有公开项目。",
                // The two halves of a paged list: the heading says where in the
                // shelf these rows sit rather than counting the rows on screen,
                // and the row numbers keep counting from there.
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
                  type: project.type,
                  status: project.status,
                  tags: project.tags,
                  logo: project.logo,
                  avatar: project.avatar,
                  iconUrl: project.iconUrl,
                })),
              },
            ]}
          />
        </div>

        <PublicPagination
          page={page}
          pageCount={pageCount}
          href={`/categories/${code}`}
        />
      </div>
    </PublicShell>
  )
}
