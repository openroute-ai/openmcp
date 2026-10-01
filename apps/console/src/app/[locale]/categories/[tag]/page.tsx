import { notFound } from "next/navigation"

import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { PublicProjectBoard } from "@/components/public/public-project-list"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import { getTagByCode } from "@/lib/github/service/tag"
import { listPublicProjectsByTag } from "@/lib/public/radar"

/**
 * One category's projects.
 *
 * A tag that exists but is excluded from rankings answers 404 here, the same as
 * a tag that does not exist: the category nav never links to it, so reaching the
 * URL means guessing, and a page that answers "this exists, you just may not
 * browse it" is a worse answer than a 404 for anyone probing.
 *
 * The list is ordered by stars rather than by a period delta, because a category
 * is a shelf, not a ranking — the rankings page is where movement is the point.
 */

export const dynamic = "force-dynamic"

export default async function PublicTagPage({
  params,
}: {
  params: Promise<{ locale: string; tag: string }>
}) {
  const { tag: code } = await params

  const tag = await getTagByCode(db, code)
  if (!tag || tag.excludeFromRankings) notFound()

  const projects = await listPublicProjectsByTag(db, code)

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
            <span>{projects.length} 个项目</span>
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
      </div>
    </PublicShell>
  )
}
