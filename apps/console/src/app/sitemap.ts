import type { MetadataRoute } from "next"
import { desc, eq, ne } from "drizzle-orm"

import { db } from "@/db/client"
import { projects, repos, tags } from "@/db/schema"
import { listPosts } from "@/lib/blog"
import { siteUrl } from "@/lib/config/site"
import { INDEXABLE_PAGES } from "@/lib/seo/indexable-pages"
import {
  allLocales,
  languageAlternates,
  localizedPath,
} from "@/lib/seo/locale-path"

/**
 * The sitemap.
 *
 * Every entry carries its own translations, so a crawler that knows both
 * languages can link them as one document instead of two competing ones. The
 * alternates map is built here rather than through next-intl's locale helpers
 * because this route runs outside a request, where they are not available, and
 * reimplementing the `as-needed` prefix rule is cheaper than getting it wrong
 * twice.
 *
 * Re-read rather than baked at build. Two thirds of the entries below are
 * derived from a database table (the categories, the projects) or change on a
 * weekly schedule (the rankings, the anomaly feed), and a sitemap that lists a
 * category added last Tuesday is the one thing a search index cannot check for
 * itself. The window is an hour because the underlying data changes at most
 * daily and a sitemap is fetched far less often than it is generated.
 */
export const revalidate = 3600

/**
 * How many project pages go in.
 *
 * A cap, because the alternative is a sitemap that grows with the catalogue and
 * is eventually the largest thing on the origin. The top slice by stars is the
 * right slice: the long tail of a project is reachable from its category and from
 * the rankings, and neither is where a crawler looking for one specific
 * repository stops looking.
 */
const PROJECT_LIMIT = 2000

/**
 * One path, in every locale.
 *
 * `x-default` in {@link languageAlternates} points at the unprefixed path, which
 * is what a crawler with no language preference is served: the proxy rewrites the
 * bare path to the default locale, so it is the spelling that resolves to a
 * document for every visitor.
 */
function perLocale(
  path: string,
  entry: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">
): MetadataRoute.Sitemap {
  return allLocales().map((locale) => ({
    url: siteUrl(localizedPath(locale, path)),
    alternates: { languages: languageAlternates(path) },
    ...entry,
  }))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = listPosts()
  const [categories, projectPaths] = await Promise.all([
    listCategoryCodes(),
    listTopProjectPaths(),
  ])

  return [
    ...INDEXABLE_PAGES.flatMap((page) =>
      perLocale(page.path, {
        changeFrequency: page.changeFrequency,
        priority: page.priority,
      })
    ),

    ...posts.flatMap((post) =>
      perLocale(`/blog/${post.slug}`, {
        // A post's date is the only date it records, and it is also the only
        // one that is true: `lastModified` for a repository markdown file would
        // otherwise be every deploy that touches the file.
        lastModified: new Date(post.date),
        changeFrequency: "yearly",
        priority: 0.6,
      })
    ),

    ...categories.flatMap((code) =>
      perLocale(`/categories/${code}`, {
        changeFrequency: "weekly",
        priority: 0.5,
      })
    ),

    ...projectPaths.flatMap((path) =>
      perLocale(path, { changeFrequency: "daily", priority: 0.4 })
    ),
  ]
}

/**
 * The tags that can be browsed as categories.
 *
 * Only the `exclude_from_rankings` filter, not the project join: whether a tag
 * currently has a visible project changes with the catalogue, and a category page
 * that renders a real header with an empty grid is still a real page. The
 * `/categories` page draws the same distinction when it says so.
 */
async function listCategoryCodes(): Promise<string[]> {
  try {
    const rows = await db
      .selectDistinct({ code: tags.code })
      .from(tags)
      .where(eq(tags.excludeFromRankings, false))
    return rows.map((row) => row.code)
  } catch {
    // An empty list costs the category pages their entries until the next
    // successful run. Throwing instead would take every static page's entry with
    // it, because this is awaited beside the rest — and those are the part a
    // crawler cannot reconstruct on its own.
    return []
  }
}

/** `/projects/owner/name` for the most-starred public projects, capped. */
async function listTopProjectPaths(): Promise<string[]> {
  try {
    const rows = await db
      .select({ owner: projects.owner, name: projects.name })
      .from(projects)
      .innerJoin(repos, eq(projects.repoId, repos.id))
      .where(ne(projects.status, "hidden"))
      .orderBy(desc(repos.stars))
      .limit(PROJECT_LIMIT)
    return rows.map((row) => `/projects/${row.owner}/${row.name}`)
  } catch {
    return []
  }
}
