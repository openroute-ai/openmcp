import type { DashboardBreadcrumbItem } from '@/components/dashboard/dashboard-header'
import { adminRoutes } from '@/lib/routes'
import type { NestedMenuItem } from '@/lib/types'

/** The subset of `next-intl`'s translator this module needs. */
export type Translate = (key: string) => string

/**
 * Paths a crumb may link to: the admin route list plus the two index pages
 * that redirect into it (`/admin` -> provider applications, `/admin/blog` ->
 * blog posts).
 */
const NAVIGABLE_ROUTES = new Set<string>([...adminRoutes, '/admin', '/admin/blog'])

/** `bank-transfers` -> `Bank transfers`: last resort for unlabeled segments. */
function humanize(segment: string): string {
  const text = segment.replace(/-/g, ' ').trim()
  if (!text) return segment
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Absolute admin path -> crumb label.
 *
 * The sidebar menu is the canonical list of destinations, so its `href` ->
 * `title` pairs cover almost every page; the entries below cover the pages
 * that exist without a sidebar item (settings, user submissions) and override
 * the few sidebar labels that read badly as a crumb (the blog tabs share one
 * heading, the security review sub-queues repeat the section name).
 */
function getRouteLabels(links: NestedMenuItem[], t: Translate): Map<string, string> {
  const labels = new Map<string, string>()

  for (const group of links) {
    for (const item of group.items ?? []) {
      if (item.href) labels.set(item.href, item.title)
    }
  }

  labels.set('/admin', t('admin.title'))
  labels.set('/admin/settings', t('admin.settings.title'))
  labels.set('/admin/user-submissions', t('admin.userSubmissions.title'))
  labels.set('/admin/blog', t('admin.blog.title'))
  labels.set('/admin/blog/posts', t('admin.blog.title'))
  labels.set('/admin/blog/authors', t('admin.crumbs.blogAuthors'))
  labels.set('/admin/blog/categories', t('admin.crumbs.blogCategories'))
  labels.set('/admin/security-review/history', t('admin.crumbs.securityHistory'))
  labels.set('/admin/security-review/rejected', t('admin.crumbs.securityRejected'))
  // `/admin/payments` is a directory, not a page: give it the label of the
  // page it leads to so the two crumbs collapse into one.
  labels.set('/admin/payments', t('admin.payments.title'))

  // An admin route added later, outside the sidebar, still gets a readable
  // crumb instead of leaking a raw path segment.
  for (const route of adminRoutes) {
    if (labels.has(route)) continue
    const last = route.split('/').filter(Boolean).at(-1)
    if (last) labels.set(route, humanize(last))
  }

  return labels
}

function resolveLabel(
  path: string,
  segment: string,
  parent: string,
  labels: Map<string, string>,
  t: Translate
): string {
  const known = labels.get(path)
  if (known) return known
  if (segment === 'edit') return t('admin.edit')
  // A dynamic `[id]` segment under a real page: the layout has no name for
  // it, so the crumb falls back to the generic detail label.
  if (parent !== '/admin' && labels.has(parent)) return t('admin.details')
  return humanize(segment)
}

/**
 * Walk the pathname below `/admin` and turn each segment into a crumb.
 *
 * `系统管理` roots every trail; consecutive crumbs with the same label
 * collapse into the deeper one so a directory segment never repeats the page
 * it points at; the last crumb is always the current page.
 */
export function buildBreadcrumbs(
  pathname: string | null,
  links: NestedMenuItem[],
  t: Translate
): DashboardBreadcrumbItem[] {
  const rootLabel = t('admin.title')
  const segments = (pathname ?? '').split('/').filter(Boolean)

  // Outside the admin tree (or before hydration) only the root is known.
  if (segments[0] !== 'admin') {
    return [{ label: rootLabel, isCurrentPage: true }]
  }

  const labels = getRouteLabels(links, t)
  const crumbs: DashboardBreadcrumbItem[] = [{ label: rootLabel, href: '/admin' }]
  let parent = '/admin'

  for (const segment of segments.slice(1)) {
    const path = `${parent}/${segment}`
    const label = resolveLabel(path, segment, parent, labels, t)
    const href = NAVIGABLE_ROUTES.has(path) ? path : undefined

    if (crumbs[crumbs.length - 1]?.label === label) {
      crumbs[crumbs.length - 1] = { label, href }
    } else {
      crumbs.push({ label, href })
    }
    parent = path
  }

  const lastIndex = crumbs.length - 1
  const last = crumbs[lastIndex]
  if (last) {
    crumbs[lastIndex] = { label: last.label, isCurrentPage: true }
  }

  return crumbs
}
