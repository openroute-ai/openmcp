import {
  PublicPageHeader,
  PublicShell,
} from "@/components/public/public-shell"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import { countPublicProjects, listPublicCategories } from "@/lib/public/radar"

/**
 * Category navigation, built from the curated taxonomy.
 *
 * The categories are the operator's `categories` rows — the same vocabulary the
 * classifier files projects under and the projects page filters by — rather than
 * the free-form tags. A tag is whatever a sync imported from a repository's
 * GitHub topics; a category is a decision an operator made about how the
 * catalogue is organised, which is the axis a reader browsing "分类" expects.
 *
 * Every active category is shown, including those with no project yet: the
 * taxonomy is curated ahead of the catalogue, so an empty category is a real
 * state and gets a zero count rather than being hidden.
 *
 * The truly-empty case — no active category at all — still gets its own
 * explanation rather than a blank grid.
 */

export const dynamic = "force-dynamic"

export default async function PublicCategoriesPage() {
  const [categories, projectTotal] = await Promise.all([
    listPublicCategories(db),
    countPublicProjects(db),
  ])

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title="应用分类"
          description="按分类浏览公开项目。"
        >
          <p className="text-xs text-muted-foreground">
            共 {projectTotal} 个公开项目 · {categories.length} 个分类
          </p>
        </PublicPageHeader>

        {categories.length === 0 ? (
          <p className="mt-6 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
            还没有可用于导航的分类。
          </p>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <LocaleLink
                key={category.code}
                href={`/categories/${category.code}`}
                className="group grid gap-1.5 rounded-xl border border-border p-4 transition-colors hover:bg-accent"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{category.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {category.projectCount} 个项目
                  </span>
                </div>
                {category.description && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {category.description}
                  </p>
                )}
                <code className="text-[11px] text-muted-foreground/70">
                  {category.code}
                </code>
              </LocaleLink>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  )
}
