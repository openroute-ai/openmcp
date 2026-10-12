'use client'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@workspace/ui/components/breadcrumb'
import { Separator } from '@workspace/ui/components/separator'
import { SidebarTrigger } from '@workspace/ui/components/sidebar'
import { useTranslations } from 'next-intl'
import { Fragment } from 'react'
import { buildBreadcrumbs } from '@/components/dashboard/admin-breadcrumbs'
import { ThemeSelector } from '@/components/layout/theme-selector'
import { SiteMessagesPanel } from '@/components/site-messages/site-messages-panel'
import { LocaleLink, useLocalePathname } from '@/i18n/navigation'
import { getAdminSidebarLinks } from '@/lib/config/sidebar-config'

/**
 * Admin console header: the sidebar collapse trigger plus breadcrumbs, so the
 * right-hand content area opens with the same bar as the user console.
 *
 * Breadcrumbs are derived from the pathname rather than declared per page,
 * which is what keeps every admin page (including `[id]` detail routes)
 * covered without touching each one.
 */
export function AdminHeader() {
  const t = useTranslations('Dashboard')
  const pathname = useLocalePathname()
  // The sidebar config resolves its labels through a hook, so it is read in
  // the component body: calling it from inside a memo would tie the hook
  // order to whether the memo had to recompute.
  const breadcrumbs = buildBreadcrumbs(pathname, getAdminSidebarLinks(), t)

  return (
    <header className='flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)'>
      <div className='flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6'>
        <SidebarTrigger className='-ml-1 cursor-pointer' />
        <Separator orientation='vertical' className='mx-2 data-[orientation=vertical]:h-4' />

        <Breadcrumb>
          <BreadcrumbList className='font-medium text-base'>
            {breadcrumbs.map((item, index) => (
              <Fragment key={`breadcrumb-${index}`}>
                {index > 0 && (
                  <BreadcrumbSeparator key={`sep-${index}`} className='hidden md:block' />
                )}
                <BreadcrumbItem
                  key={`item-${index}`}
                  className={index < breadcrumbs.length - 1 ? 'hidden md:block' : ''}
                >
                  {item.isCurrentPage ? (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                  ) : item.href ? (
                    <LocaleLink href={item.href}>{item.label}</LocaleLink>
                  ) : (
                    item.label
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        {/* admin header actions on the right side */}
        <div className='ml-auto flex items-center gap-3 px-4'>
          <SiteMessagesPanel />
          <ThemeSelector />
        </div>
      </div>
    </header>
  )
}
