'use client'

import type { User } from 'better-auth'
import { ChevronsUpDown, Languages, LaptopIcon, LogOut, MoonIcon, SunIcon } from 'lucide-react'
import { useParams } from 'next/navigation'
import { type Locale, useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { useTransition } from 'react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@workspace/ui/components/sidebar'
import { UserAvatar } from '@/components/layout/user-avatar'
import { useLocalePathname, useLocaleRouter } from '@/i18n/navigation'
import { LOCALES, routing } from '@/i18n/routing'
import { authClient } from '@/lib/auth-client'
import { websiteConfig } from '@/lib/config/website'
import { useLocaleStore } from '@/lib/stores/locale-store'
import { usePaymentStore } from '@/lib/stores/payment-store'
import { cn } from '@/lib/utils'

interface SidebarUserProps {
  user: User
  className?: string
}

/**
 * User navigation for the dashboard sidebar
 */
export function SidebarUser({ user, className }: SidebarUserProps) {
  const { setTheme } = useTheme()
  const router = useLocaleRouter()
  const { isMobile, state } = useSidebar()
  const isCollapsed = state === 'collapsed'
  const pathname = useLocalePathname()
  const params = useParams()
  const { setCurrentLocale } = useLocaleStore()
  const { resetState } = usePaymentStore()
  const [, startTransition] = useTransition()
  const t = useTranslations()

  const setLocale = (nextLocale: Locale) => {
    setCurrentLocale(nextLocale)

    startTransition(() => {
      router.replace(
        // @ts-expect-error -- TypeScript validates that only known `params` are
        // used with a given `pathname`. The two always match for the current
        // route, so the runtime check can be skipped.
        { pathname, params },
        { locale: nextLocale }
      )
    })
  }

  const showModeSwitch = websiteConfig.metadata.mode?.enableSwitch ?? false
  const showLocaleSwitch = LOCALES.length > 1

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          // Reset payment state on sign out
          resetState()
          router.replace('/')
        },
        onError: (error) => {
          console.error('sign out error:', error)
          toast.error(t('Common.logoutFailed'))
        },
      },
    })
  }

  return (
    <SidebarMenu className={className}>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size='lg'
              className='cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
            >
              <UserAvatar name={user.name} image={user.image} className='size-8 border' />

              <div className={cn('grid flex-1 text-left text-sm leading-tight', isCollapsed && 'hidden')}>
                <span className='truncate font-semibold'>{user.name}</span>
                <span className='truncate text-xs'>{user.email}</span>
              </div>
              <ChevronsUpDown className={cn('ml-auto size-4', isCollapsed && 'hidden')} />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
            side={isMobile ? 'bottom' : 'right'}
            align='end'
            sideOffset={4}
          >
            <DropdownMenuLabel className='p-0 font-normal'>
              <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
                <UserAvatar name={user.name} image={user.image} className='size-8 border' />
                <div className='grid flex-1 text-left text-sm leading-tight'>
                  <span className='truncate font-semibold'>{user.name}</span>
                  <span className='truncate text-xs'>{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>

            {(showModeSwitch || showLocaleSwitch) && <DropdownMenuSeparator />}

            {showModeSwitch && (
              <DropdownMenuGroup>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className='cursor-pointer'>
                    <LaptopIcon className='mr-2 size-4' />
                    <span>{t('Common.mode.label')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem className='cursor-pointer' onClick={() => setTheme('light')}>
                      <SunIcon className='mr-2 size-4' />
                      <span>{t('Common.mode.light')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem className='cursor-pointer' onClick={() => setTheme('dark')}>
                      <MoonIcon className='mr-2 size-4' />
                      <span>{t('Common.mode.dark')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem className='cursor-pointer' onClick={() => setTheme('system')}>
                      <LaptopIcon className='mr-2 size-4' />
                      <span>{t('Common.mode.system')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
            )}

            {showLocaleSwitch && (
              <DropdownMenuGroup>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className='cursor-pointer'>
                    <Languages className='mr-2 size-4' />
                    <span>{t('Common.language')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {routing.locales.map((localeOption) => {
                      const localeInfo =
                        websiteConfig.i18n.locales[localeOption as keyof typeof websiteConfig.i18n.locales]
                      return (
                        <DropdownMenuItem
                          key={localeOption}
                          onClick={() => setLocale(localeOption)}
                          className='cursor-pointer'
                        >
                          {localeInfo?.flag && <span className='mr-2 text-md'>{localeInfo?.flag}</span>}
                          <span className='text-sm'>{localeInfo?.name}</span>
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className='cursor-pointer'
              onClick={async (event) => {
                event.preventDefault()
                handleSignOut()
              }}
            >
              <LogOut className='mr-2 size-4' />
              {t('Common.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
