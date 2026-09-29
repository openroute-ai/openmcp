'use client'

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@workspace/ui/components/sidebar'
import { useSearchParams } from 'next/navigation'
import { LocaleLink, useLocalePathname } from '@/i18n/navigation'
import type { NestedMenuItem } from '@/lib/types'

/**
 * Main navigation for the dashboard sidebar
 */
export function SidebarMain({ items }: { items: NestedMenuItem[] }) {
  const pathname = useLocalePathname()
  const searchParams = useSearchParams()
  const section = searchParams.get('section')

  // Function to check if a path is active
  const isActive = (href: string | undefined): boolean => {
    if (!href) return false

    const [path, query] = href.split('?')

    // Hub page (/settings): account info is the default section, while security
    // settings are distinguished by ?section=security.
    if (path === '/settings') {
      if (query?.startsWith('section=')) {
        return pathname === '/settings' && section === query.split('=')[1]
      }
      return pathname === '/settings' && section !== 'security'
    }

    // Special handling for /dashboard
    if (path === '/dashboard') {
      return pathname === '/dashboard'
    }

    // Default behavior for other paths
    return pathname === path || pathname.startsWith(`${path}/`)
  }

  return (
    <>
      {/* Render items with children as SidebarGroup */}
      {items.map((item) =>
        item.items && item.items.length > 0 ? (
          <SidebarGroup key={item.title}>
            <SidebarGroupLabel>{item.title}</SidebarGroupLabel>
            <SidebarGroupContent className='flex flex-col gap-2'>
              <SidebarMenu>
                {item.items.map((subItem) => (
                  <SidebarMenuItem key={subItem.title}>
                    <SidebarMenuButton asChild isActive={isActive(subItem.href)}>
                      <LocaleLink href={subItem.href || ''}>
                        {subItem.icon ? subItem.icon : null}
                        <span className='truncate font-medium text-sm'>{subItem.title}</span>
                      </LocaleLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          /* Render items without children directly in a SidebarMenu */
          <SidebarGroup key={item.title}>
            <SidebarGroupContent className='flex flex-col gap-2'>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive(item.href)}>
                    <LocaleLink href={item.href || ''}>
                      {item.icon ? item.icon : null}
                      <span className='truncate font-medium text-sm'>{item.title}</span>
                    </LocaleLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )
      )}
    </>
  )
}
