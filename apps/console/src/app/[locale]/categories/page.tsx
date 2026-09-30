import {
  PublicPageHeader,
  PublicShell,
} from "@/components/public/public-shell"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import { countPublicProjects, listPublicTags } from "@/lib/public/radar"

/**
 * Category navigation, built from tags.
 *
 * Tags are the categories here, and the choice was made against a table of what
 * actually has data: `capabilities` is the schema's other classification axis
 * and it is the better fit for filtering — it answers "what does this speak" —
 * but nothing writes to it yet (the AI classification that would fill it is a v1
 * task), so a filter rail built on it today is a row of empty controls. Tags are
 * curated by a human and already drive the ranking filters, so they are the one
 * axis the page can be honest about on day one.
 *
 * The empty case is a real state and gets its own explanation rather than a
 * blank grid: a fresh install has tags but no projects carrying them.
 */

export const dynamic = "force-dynamic"

export default async function PublicCategoriesPage() {
  const [tags, projectTotal] = await Promise.all([
    listPublicTags(db),
    countPublicProjects(db),
  ])

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title="应用分类"
          description="按人工策展的标签浏览公开项目。标签只收录可用于导航的分类，不含运营内部标记。"
        >
          <p className="text-xs text-muted-foreground">
            共 {projectTotal} 个公开项目 · {tags.length} 个分类
          </p>
        </PublicPageHeader>

        {tags.length === 0 ? (
          <p className="mt-6 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
            还没有可用于导航的分类。标签需要人工策展并挂到项目上才会出现在这里。
          </p>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tags.map((tag) => (
              <LocaleLink
                key={tag.code}
                href={`/categories/${tag.code}`}
                className="group grid gap-1.5 rounded-xl border border-border p-4 transition-colors hover:bg-accent"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{tag.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {tag.projectCount} 个项目
                  </span>
                </div>
                {tag.description && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {tag.description}
                  </p>
                )}
                <code className="text-[11px] text-muted-foreground/70">
                  {tag.code}
                </code>
              </LocaleLink>
            ))}
          </div>
        )}

        <p className="mt-8 text-xs text-muted-foreground">
          筛选维度说明：分类导航用 tags。capabilities（能力轴，用于筛选「支持哪些技术」）已在
          schema 中就位，但目前没有写入路径，等自动分类上线后再作为补充筛选器开放。
        </p>
      </div>
    </PublicShell>
  )
}
