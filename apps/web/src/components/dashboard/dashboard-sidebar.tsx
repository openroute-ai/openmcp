'use client'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@workspace/ui/components/sidebar'
import { BookOpenIcon, SettingsIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type * as React from 'react'
import { useEffect, useState } from 'react'
import { Logo } from '@/components/layout/logo'
import { SidebarMain } from '@/components/dashboard/sidebar-main'
import { SidebarUser } from '@/components/dashboard/sidebar-user'
import { LocaleLink, useLocalePathname } from '@/i18n/navigation'
import { authClient } from '@/lib/auth-client'
import { getAdminSidebarLinks, getUserSidebarLinks } from '@/lib/config/sidebar-config'
import { Routes } from '@/lib/routes'
import type { MenuItem, NestedMenuItem } from '@/lib/types'
import { trpc } from '@/lib/trpc/client'

interface DashboardSidebarProps extends React.ComponentProps<typeof Sidebar> {
  /**
   * Which menu to render: the user console menu or the admin menu.
   * @default 'user'
   */
  type?: 'user' | 'admin'
}

function filterSidebarLinks(
  links: NestedMenuItem[],
  options: { role: string; isProvider: boolean }
): NestedMenuItem[] {
  const { role, isProvider } = options

  const result: NestedMenuItem[] = []

  for (const link of links) {
    if (link.authorizeOnly && !link.authorizeOnly.includes(role)) {
      continue
    }
    if (link.requireProvider && !isProvider) {
      continue
    }

    if (link.items && link.items.length > 0) {
      const filteredItems = link.items.filter((item: MenuItem) => {
        if (item.authorizeOnly && !item.authorizeOnly.includes(role)) {
          return false
        }
        if (item.requireProvider && !isProvider) {
          return false
        }
        return true
      })
      if (filteredItems.length === 0) {
        continue
      }
      result.push({ ...link, items: filteredItems })
      continue
    }

    result.push(link)
  }

  return result
}

/**
 * Dashboard sidebar
 */
export function DashboardSidebar({ type = 'user', ...props }: DashboardSidebarProps) {
  const t = useTranslations()
  const [mounted, setMounted] = useState(false)
  const pathname = useLocalePathname()
  const { data: session, isPending } = authClient.useSession()
  const currentUser = session?.user

  const sidebarLinks = type === 'admin' ? getAdminSidebarLinks() : getUserSidebarLinks()

  // Persistent entries pinned to the bottom of the sidebar: they are entry
  // points rather than sections, so they live outside the scrollable content.
  const footerLinks: MenuItem[] = [
    {
      title: t('Dashboard.settings.setup.title'),
      icon: <SettingsIcon className='size-4 shrink-0' />,
      href: Routes.SettingsSetup,
      external: false,
    },
    {
      title: t('Dashboard.sidebar.helpDocs'),
      icon: <BookOpenIcon className='size-4 shrink-0' />,
      href: Routes.Docs,
      external: false,
    },
  ]

  // Provider identity gates the whole "Publish" group.
  const { data: providerStatusData } = trpc.dashboard.getUserProviderStatus.useQuery(undefined, {
    enabled: type === 'user' && !!currentUser,
  })
  const isProviderUser = Boolean(providerStatusData?.data?.isProvider)

  const filteredSidebarLinks = filterSidebarLinks(sidebarLinks, {
    role: currentUser?.role || '',
    isProvider: type === 'user' ? isProviderUser : true,
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <Sidebar collapsible='icon' {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className='data-[slot=sidebar-menu-button]:!p-1.5'>
              <LocaleLink href={Routes.Root}>
                <Logo className='size-5' />
                <span className='truncate font-semibold text-base'>{t('Metadata.name')}</span>
              </LocaleLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMain items={filteredSidebarLinks} />
      </SidebarContent>

      <SidebarFooter className='flex flex-col gap-4'>
        <SidebarMenu>
          {footerLinks.map((link) => (
            <SidebarMenuItem key={link.href}>
              <SidebarMenuButton
                asChild
                isActive={!!link.href && (pathname === link.href || pathname.startsWith(`${link.href}/`))}
              >
                <LocaleLink href={link.href || ''}>
                  {link.icon}
                  <span className='truncate font-medium text-sm'>{link.title}</span>
                </LocaleLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>

        {/* Only render once the session has resolved, otherwise the footer flashes empty. */}
        {!isPending && mounted && currentUser && <SidebarUser user={currentUser} />}
      </SidebarFooter>
    </Sidebar>
  )
}
