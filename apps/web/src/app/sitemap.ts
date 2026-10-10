import { a2aAgents, authors, categories, mcpServers, skills, workflows } from '@workspace/db'
import { eq } from 'drizzle-orm'
import type { MetadataRoute } from 'next'
import { routing } from '@/i18n/routing'
import { db } from '@/lib/db'
import { getBaseUrl } from '@/lib/urls/urls'
import { marketVisible } from '@/web/assets/visibility'

// The registry rows are loaded per request — the build never touches the
// database. With the previous `revalidate = 3600` this route was generated
// statically inside `docker build`/CI, where no database exists, and the six
// queries failed with ECONNREFUSED and aborted the image build. As a dynamic
// route it is skipped at build time and renders on demand at runtime, where a
// database is guaranteed to be reachable.
export const dynamic = 'force-dynamic'

type Entry = MetadataRoute.Sitemap[number]

/**
 * Sitemap for the public surface.
 *
 * Locale-prefixed variants are emitted as `alternates.languages` on a single
 * entry rather than as separate entries: the default locale is unprefixed, so
 * listing every locale twice would hand crawlers two URLs for the same page.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl()

  const entry = (
    path: string,
    changeFrequency: Entry['changeFrequency'],
    priority: number,
    lastModified?: Date
  ): Entry => ({
    url: new URL(path, baseUrl).toString(),
    lastModified,
    changeFrequency,
    priority,
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((locale) => [
          locale,
          new URL(
            locale === routing.defaultLocale ? path : `/${locale}${path}`,
            baseUrl
          ).toString(),
        ])
      ),
    },
  })

  const entries: Entry[] = [
    entry('/', 'daily', 1),
    entry('/workflows', 'daily', 0.9),
    entry('/skills', 'daily', 0.9),
    entry('/a2a', 'daily', 0.9),
    entry('/mcp', 'daily', 0.9),
    entry('/personas', 'daily', 0.9),
    entry('/tools', 'daily', 0.9),
    entry('/categories', 'weekly', 0.8),
    entry('/authors', 'weekly', 0.7),
    entry('/ranking', 'daily', 0.7),
    entry('/openpay', 'weekly', 0.7),
    entry('/about', 'monthly', 0.6),
    entry('/contact', 'monthly', 0.6),
    entry('/changelog', 'weekly', 0.5),
    entry('/waitlist', 'monthly', 0.4),
    entry('/guide', 'monthly', 0.5),
    entry('/cookie', 'yearly', 0.2),
    entry('/privacy', 'yearly', 0.2),
    entry('/terms', 'yearly', 0.2),
  ]

  // Published registry rows. The queries run in parallel so a sitemap request
  // costs one round trip instead of six.
  const [publishedWorkflows, publishedSkills, publishedA2aAgents, publishedMcpServers, activeCategories, authorsWithContent] =
    await Promise.all([
      db
        .select({ slug: workflows.slug, id: workflows.id, updatedAt: workflows.updatedAt, publishedAt: workflows.publishedAt })
        .from(workflows)
        .where(eq(workflows.status, 'published')),
      db
        .select({ slug: skills.slug, id: skills.id, updatedAt: skills.updatedAt, publishedAt: skills.publishedAt })
        .from(skills)
        .where(eq(skills.status, 'published')),
      db
        .select({ slug: a2aAgents.slug, id: a2aAgents.id, updatedAt: a2aAgents.updatedAt, publishedAt: a2aAgents.publishedAt })
        .from(a2aAgents)
        .where(marketVisible(a2aAgents)),
      db
        .select({ slug: mcpServers.slug, id: mcpServers.id, updatedAt: mcpServers.updatedAt, publishedAt: mcpServers.publishedAt })
        .from(mcpServers)
        .where(marketVisible(mcpServers)),
      db
        .select({ slug: categories.slug, updatedAt: categories.updatedAt, createdAt: categories.createdAt })
        .from(categories),
      db
        .selectDistinct({ username: authors.username, updatedAt: authors.updatedAt })
        .from(authors)
        .innerJoin(workflows, eq(workflows.authorId, authors.id))
        .where(eq(workflows.status, 'published')),
    ])

  for (const item of publishedWorkflows) {
    entries.push(entry(`/workflows/${item.slug || item.id}`, 'weekly', 0.8, item.updatedAt ?? item.publishedAt ?? undefined))
  }
  for (const item of publishedSkills) {
    entries.push(entry(`/skills/${item.slug || item.id}`, 'weekly', 0.8, item.updatedAt ?? item.publishedAt ?? undefined))
  }
  for (const item of publishedA2aAgents) {
    entries.push(entry(`/a2a/${item.slug || item.id}`, 'weekly', 0.8, item.updatedAt ?? item.publishedAt ?? undefined))
  }
  for (const item of publishedMcpServers) {
    entries.push(entry(`/mcp/${item.slug || item.id}`, 'weekly', 0.8, item.updatedAt ?? item.publishedAt ?? undefined))
  }
  for (const item of activeCategories) {
    entries.push(entry(`/categories/${item.slug}`, 'weekly', 0.7, item.updatedAt ?? item.createdAt ?? undefined))
  }
  // Only authors who actually have published rows get a page worth indexing.
  for (const item of authorsWithContent) {
    entries.push(entry(`/authors/${item.username}`, 'weekly', 0.6, item.updatedAt ?? undefined))
  }

  return entries
}
