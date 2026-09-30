import { notFound } from "next/navigation"

import {
  PublicPageHeader,
  PublicShell,
} from "@/components/public/public-shell"
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
            <LocaleLink href="/categories" className="hover:text-foreground hover:underline">
              ← 全部分类
            </LocaleLink>
            <span>·</span>
            <span>{projects.length} 个项目</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {tag.code}
            </code>
          </div>
        </PublicPageHeader>

        {projects.length === 0 ? (
          <p className="mt-6 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
            这个分类下还没有公开项目。
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">项目</th>
                  <th className="w-28 py-2 font-medium">类型</th>
                  <th className="w-24 py-2 text-right font-medium">星标</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-b border-border/60">
                    <td className="py-2.5">
                      <LocaleLink
                        href={`/projects/${project.owner}/${project.name}`}
                        className="font-medium hover:underline"
                      >
                        {project.fullName}
                      </LocaleLink>
                      {project.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {project.description}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">
                      {project.type}
                      {project.status === "deprecated" && (
                        <span className="ml-1.5 text-destructive">已弃用</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {project.stars.toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PublicShell>
  )
}
