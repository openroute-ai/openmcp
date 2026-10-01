import type { MetadataRoute } from 'next'
import { routing } from '@/i18n/routing'
import { getBaseUrl } from '@/lib/urls/urls'

/**
 * Crawl rules.
 *
 * `disallow` here is advisory for crawlers, not an access control — the console
 * and admin surfaces are already session-gated in the middleware. The list is
 * kept so the private pages stay out of search indexes and out of AI crawlers'
 * training corpora.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/*',
        '/_next/*',
        '/auth/*',
        '/sign-in',
        '/sign-up',
        '/settings/*',
        '/dashboard/*',
        '/admin/*',
      ],
    },
    sitemap: `${getBaseUrl()}/sitemap.xml`,
  }
}
