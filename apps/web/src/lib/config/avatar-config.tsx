'use client'

import { CreditCardIcon, LayoutDashboardIcon, Settings2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Routes } from '@/lib/routes'
import type { MenuItem } from '@/lib/types'

/**
 * Get avatar config with translations
 *
 * NOTICE: used in client components only
 *
 * docs:
 * https://openroute.cn/docs/config/avatar
 *
 * @returns The avatar config with translated titles
 */
export function getAvatarLinks(): MenuItem[] {
  const t = useTranslations('Marketing.avatar')

  return [
    {
      title: t('dashboard'),
      href: Routes.Dashboard,
      icon: <LayoutDashboardIcon className='size-4 shrink-0' />,
    },
    {
      title: t('wallet'),
      href: Routes.SettingsRecharge,
      icon: <CreditCardIcon className='size-4 shrink-0' />,
    },
    {
      title: t('settings'),
      href: Routes.SettingsSetup,
      icon: <Settings2Icon className='size-4 shrink-0' />,
    },
  ]
}
