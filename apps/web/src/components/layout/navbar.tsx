'use client'

import { Button } from '@workspace/ui/components/button'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@workspace/ui/components/navigation-menu'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { ArrowUpRightIcon, FilePlus2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { LoginWrapper } from '@/components/auth/login-wrapper'
import Container from '@/components/layout/container'
import { Logo } from '@/components/layout/logo'
import { ModeSwitcher } from '@/components/layout/mode-switcher'
import { NavbarMobile } from '@/components/layout/navbar-mobile'
import { UserButton } from '@/components/layout/user-button'
import { useScroll } from '@/hooks/use-scroll'
import { LocaleLink, useLocalePathname } from '@/i18n/navigation'
import { authClient } from '@/lib/auth-client'
import { getNavbarLinks } from '@/lib/config/navbar-config'
import { cn } from '@/lib/utils'
import LocaleSwitcher from './locale-switcher'

interface NavBarProps {
  scroll?: boolean
}

const customNavigationMenuTriggerStyle = cn(
  navigationMenuTriggerStyle(),
  'relative cursor-pointer bg-transparent text-muted-foreground',
  'hover:bg-accent hover:text-accent-foreground',
  'focus:bg-accent focus:text-accent-foreground',
  'data-active:bg-transparent data-active:font-semibold data-active:text-foreground',
  'data-[state=open]:bg-transparent data-[state=open]:text-foreground'
)

export function Navbar({ scroll }: NavBarProps) {
  const t = useTranslations()
  const locale = useLocale()
  const scrolled = useScroll(50)
  const menuLinks = getNavbarLinks()
  const localePathname = useLocalePathname()
  const [mounted, setMounted] = useState(false)
  const { data: session, isPending } = authClient.useSession()
  const currentUser = session?.user
  // console.log(`Navbar, user:`, user);

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <section
      className={cn(
        'sticky inset-x-0 top-0 z-40 py-4 transition-all duration-300',
        scroll
          ? scrolled
            ? 'border-b bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/60'
            : 'bg-transparent'
          : 'border-b bg-background'
      )}
    >
      <Container className='px-5'>
        {/* desktop navbar */}
        <nav className='hidden lg:flex'>
          {/* logo and name */}
          <div className='flex items-center'>
            <LocaleLink href='/' className='flex items-center space-x-2'>
              <Logo />
              <span className='font-semibold text-xl'>{t('Metadata.name')}</span>
            </LocaleLink>
          </div>

          {/* menu links */}
          <div className='flex flex-1 items-center justify-center space-x-2'>
            <NavigationMenu className='relative'>
              <NavigationMenuList className='flex items-center'>
                {menuLinks?.map((item, index) =>
                  item.items ? (
                    <NavigationMenuItem key={index} className='relative'>
                      <NavigationMenuTrigger
                        data-active={
                          item.items.some((subItem) => (subItem.href ? localePathname.startsWith(subItem.href) : false))
                            ? 'true'
                            : undefined
                        }
                        className={customNavigationMenuTriggerStyle}
                      >
                        {item.title}
                      </NavigationMenuTrigger>
                      <NavigationMenuContent>
                        <ul className='grid w-[400px] gap-4 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px]'>
                          {item.items?.map((subItem, subIndex) => {
                            const isSubItemActive = subItem.href && localePathname.startsWith(subItem.href)
                            return (
                              <li key={subIndex}>
                                <NavigationMenuLink asChild>
                                  <LocaleLink
                                    href={subItem.href || '#'}
                                    target={subItem.external ? '_blank' : undefined}
                                    rel={subItem.external ? 'noopener noreferrer' : undefined}
                                    className={cn(
                                      'group flex select-none flex-row items-center gap-4 rounded-md',
                                      'p-2 leading-none no-underline outline-hidden transition-colors',
                                      'hover:bg-accent hover:text-accent-foreground',
                                      'focus:bg-accent focus:text-accent-foreground',
                                      isSubItemActive && 'bg-accent text-accent-foreground'
                                    )}
                                  >
                                    <div
                                      className={cn(
                                        'flex size-8 shrink-0 items-center justify-center transition-colors',
                                        'bg-transparent text-muted-foreground',
                                        'group-hover:bg-transparent group-hover:text-foreground',
                                        'group-focus:bg-transparent group-focus:text-foreground',
                                        isSubItemActive && 'bg-transparent text-foreground'
                                      )}
                                    >
                                      {subItem.icon ? subItem.icon : null}
                                    </div>
                                    <div className='flex-1'>
                                      <div
                                        className={cn(
                                          'font-medium text-muted-foreground text-sm',
                                          'group-hover:bg-transparent group-hover:text-foreground',
                                          'group-focus:bg-transparent group-focus:text-foreground',
                                          isSubItemActive && 'bg-transparent text-foreground'
                                        )}
                                      >
                                        {subItem.title}
                                      </div>
                                      {subItem.description && (
                                        <div
                                          className={cn(
                                            'text-muted-foreground text-sm',
                                            'group-hover:bg-transparent group-hover:text-foreground/80',
                                            'group-focus:bg-transparent group-focus:text-foreground/80',
                                            isSubItemActive && 'bg-transparent text-foreground/80'
                                          )}
                                        >
                                          {subItem.description}
                                        </div>
                                      )}
                                    </div>
                                    {subItem.external && (
                                      <ArrowUpRightIcon
                                        className={cn(
                                          'size-4 shrink-0 text-muted-foreground',
                                          'group-hover:bg-transparent group-hover:text-foreground',
                                          'group-focus:bg-transparent group-focus:text-foreground',
                                          isSubItemActive && 'bg-transparent text-foreground'
                                        )}
                                      />
                                    )}
                                  </LocaleLink>
                                </NavigationMenuLink>
                              </li>
                            )
                          })}
                        </ul>
                      </NavigationMenuContent>
                    </NavigationMenuItem>
                  ) : (
                    <NavigationMenuItem key={index}>
                      <NavigationMenuLink
                        asChild
                        active={item.href ? localePathname.startsWith(item.href) : false}
                        className={customNavigationMenuTriggerStyle}
                      >
                        <LocaleLink
                          href={item.href || '#'}
                          target={item.external ? '_blank' : undefined}
                          rel={item.external ? 'noopener noreferrer' : undefined}
                        >
                          {item.title}
                        </LocaleLink>
                      </NavigationMenuLink>
                    </NavigationMenuItem>
                  )
                )}
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          {/* navbar right show sign in or user */}
          <div className='flex items-center gap-x-4'>
            <Button asChild size='sm' className='h-[34px] shrink-0 cursor-pointer px-[12px] font-medium text-[13px]'>
              <LocaleLink href='/skills/submit'>
                <FilePlus2 className='mr-1 h-3.5 w-3.5' />
                {locale === 'zh' ? '发布 Skill' : 'Publish Skill'}
              </LocaleLink>
            </Button>

            {!mounted || isPending ? (
              <Skeleton className='size-8 rounded-full border' />
            ) : currentUser ? (
              <UserButton user={currentUser} />
            ) : (
              <div className='flex items-center gap-x-4'>
                <LoginWrapper mode='modal' asChild>
                  <Button size='sm' className='cursor-pointer'>
                    {t('Common.login')}
                  </Button>
                </LoginWrapper>
              </div>
            )}

            <ModeSwitcher />
            <LocaleSwitcher />
          </div>
        </nav>

        {/* mobile navbar */}
        <NavbarMobile className='lg:hidden' />
      </Container>
    </section>
  )
}
