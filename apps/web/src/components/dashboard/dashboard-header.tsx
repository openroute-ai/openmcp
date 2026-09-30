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
import React, { type ReactNode, useEffect } from 'react'
import { FirstLoginPrompt } from '@/components/dashboard/first-login-prompt'
import { ThemeSelector } from '@/components/layout/theme-selector'
import { SiteMessagesPanel } from '@/components/site-messages/site-messages-panel'
import { LocaleLink } from '@/i18n/navigation'
import { useFirstLoginStore } from '@/lib/stores/first-login-store'
import { trpc } from '@/lib/trpc/client'
import { authClient } from '@/lib/auth-client'

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
 * Dashboard header: breadcrumbs, page actions, notifications, theme.
 *
 * Also hosts the first-login welcome banner. The banner needs no "are we
 * mounted yet" guard: `shouldShowPrompt` is deliberately excluded from the
 * store's persisted slice, so it is always `null` on the first render of any
 * page and only turns `true` after `checkFirstLogin` resolves on the client. A
 * returning user whose dismissal lives in localStorage therefore cannot have it
 * flash during hydration.
 */
export function DashboardHeader({ breadcrumbs, actions }: DashboardHeaderProps) {
  const { data: session, isPending } = authClient.useSession()
  const currentUser = session?.user

  const { shouldShowPrompt, dismissed, setFirstLoginStatus, dismissPrompt, reset, isCacheValid } =
    useFirstLoginStore()

  const { data: firstLoginData } = trpc.firstLogin.checkFirstLogin.useQuery(undefined, {
    // Skipped entirely when the persisted dismissal is still trustworthy, so
    // the common case costs no request.
    enabled: !isPending && Boolean(currentUser) && !isCacheValid(currentUser?.id ?? null),
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  })

  // Signing out, or switching accounts in the same browser, must not inherit
  // the previous user's dismissal.
  useEffect(() => {
    if (currentUser?.id) {
      if (!isCacheValid(currentUser.id)) reset()
    } else {
      reset()
    }
  }, [currentUser?.id, isCacheValid, reset])

  useEffect(() => {
    if (firstLoginData && currentUser?.id && !isCacheValid(currentUser.id)) {
      setFirstLoginStatus(currentUser.id, firstLoginData.isFirstLogin)
    }
  }, [firstLoginData, currentUser?.id, setFirstLoginStatus, isCacheValid])

  // A live `true` from the query wins; a `null` means the check has not landed
  // yet, in which case there is nothing to show.
  const shouldShowPromptBanner =
    !isPending && Boolean(currentUser) && !dismissed && shouldShowPrompt === true

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

          {shouldShowPromptBanner && <FirstLoginPrompt show onDismiss={dismissPrompt} />}

          <SiteMessagesPanel />

          <ThemeSelector />
        </div>
      </div>
    </header>
  )
}
