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
import React, { type ReactNode } from 'react'
import { ThemeSelector } from '@/components/layout/theme-selector'
import { LocaleLink } from '@/i18n/navigation'

interface DashboardBreadcrumbItem {
  label: string
  isCurrentPage?: boolean
  href?: string
}

interface DashboardHeaderProps {
  breadcrumbs: DashboardBreadcrumbItem[]
  actions?: ReactNode
}

/**
 * Dashboard header
 */
export function DashboardHeader({ breadcrumbs, actions }: DashboardHeaderProps) {
  return (
    <header className='flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)'>
      <div className='flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6'>
        <SidebarTrigger className='-ml-1 cursor-pointer' />
        <Separator orientation='vertical' className='mx-2 data-[orientation=vertical]:h-4' />

        <Breadcrumb>
          <BreadcrumbList className='font-medium text-base'>
            {breadcrumbs.map((item, index) => (
              <React.Fragment key={`breadcrumb-${index}`}>
                {index > 0 && <BreadcrumbSeparator key={`sep-${index}`} className='hidden md:block' />}
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
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        {/* dashboard header actions on the right side */}
        <div className='ml-auto flex items-center gap-3 px-4'>
          {actions}

          <ThemeSelector />
        </div>
      </div>
    </header>
  )
}
