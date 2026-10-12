/**
 * Admin breadcrumb derivation.
 *
 * The admin header builds its trail from the pathname instead of asking every
 * page for one, so the rules that are invisible in the UI — a directory
 * segment collapsing into the page it leads to, an `[id]` becoming `详情`, a
 * sidebar label overridden where it reads badly — have to be written out
 * somewhere. That is this file: the cases below are the ones a reviewer would
 * otherwise have to click through `/admin/*` to check.
 *
 * `links` stands in for the real sidebar menu (`getAdminSidebarLinks()`),
 * which resolves its labels through `useTranslations` and therefore cannot be
 * called from a test; the shape matches what it returns.
 */
import { describe, expect, it } from 'vitest'
import { buildBreadcrumbs } from '@/components/dashboard/admin-breadcrumbs'
import type { NestedMenuItem } from '@/lib/types'

const MESSAGES: Record<string, string> = {
  'admin.title': '系统管理',
  'admin.details': '详情',
  'admin.edit': '编辑',
  'admin.settings.title': '系统设置',
  'admin.userSubmissions.title': '用户提交',
  'admin.blog.title': '博客',
  'admin.crumbs.blogAuthors': '作者',
  'admin.crumbs.blogCategories': '分类',
  'admin.crumbs.securityHistory': '审核历史',
  'admin.crumbs.securityRejected': '驳回记录',
  'admin.payments.title': '支付管理',
}

const t = (key: string) => MESSAGES[key] ?? key

const LINKS: NestedMenuItem[] = [
  {
    title: 'group',
    items: [
      { title: '用户管理', href: '/admin/users' },
      { title: '安全审核', href: '/admin/security-review' },
      { title: '博客', href: '/admin/blog/posts' },
      { title: '创作者', href: '/admin/blog/authors' },
      { title: '分类', href: '/admin/blog/categories' },
      { title: '支付管理', href: '/admin/payments/bank-transfers' },
      { title: 'MCP 管理', href: '/admin/mcp-servers' },
    ],
  },
]

/** `用户管理 -> /admin/users` / `用户管理*` (current page) keeps assertions readable. */
function crumbs(pathname: string | null) {
  return buildBreadcrumbs(pathname, LINKS, t).map((crumb) =>
    crumb.isCurrentPage ? `${crumb.label}*` : `${crumb.label}${crumb.href ? ` -> ${crumb.href}` : ''}`
  )
}

describe('admin breadcrumbs', () => {
  it('roots every trail at the admin console and marks the page current', () => {
    expect(crumbs('/admin/users')).toEqual(['系统管理 -> /admin', '用户管理*'])
  })

  it('labels a dynamic id and an edit step', () => {
    expect(crumbs('/admin/users/abc/edit')).toEqual([
      '系统管理 -> /admin',
      '用户管理 -> /admin/users',
      '详情',
      '编辑*',
    ])
  })

  it('keeps the section as the parent crumb of its sub-queue', () => {
    expect(crumbs('/admin/security-review/history')).toEqual([
      '系统管理 -> /admin',
      '安全审核 -> /admin/security-review',
      '审核历史*',
    ])
    expect(crumbs('/admin/security-review/rejected')).toEqual([
      '系统管理 -> /admin',
      '安全审核 -> /admin/security-review',
      '驳回记录*',
    ])
  })

  it('overrides the sidebar label where the blog tab is the real name', () => {
    expect(crumbs('/admin/blog/authors')).toEqual([
      '系统管理 -> /admin',
      '博客 -> /admin/blog',
      '作者*',
    ])
    expect(crumbs('/admin/blog/posts/abc')).toEqual([
      '系统管理 -> /admin',
      '博客 -> /admin/blog/posts',
      '详情*',
    ])
  })

  it('collapses a directory segment into the page it leads to', () => {
    expect(crumbs('/admin/payments/bank-transfers')).toEqual([
      '系统管理 -> /admin',
      '支付管理*',
    ])
  })

  it('falls back to the root outside the admin tree', () => {
    expect(crumbs('/dashboard')).toEqual(['系统管理*'])
    expect(crumbs(null)).toEqual(['系统管理*'])
  })
})
