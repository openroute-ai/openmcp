'use client'

import {
  ActivityIcon,
  BotIcon,
  CreditCardIcon,
  DollarSignIcon,
  DownloadIcon,
  HeartIcon,
  KeyIcon,
  LayersIcon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WalletIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Routes } from '@/lib/routes'
import type { NestedMenuItem } from '@/lib/types'

/**
 * Sidebar config for the user console, with translations applied.
 *
 * Only routes that exist in this app are listed: the console is the entry
 * point, so a dead link here is worse than a missing entry.
 *
 * NOTICE: used in client components only
 */
export function getUserSidebarLinks(): NestedMenuItem[] {
  const t = useTranslations('Dashboard')

  const links: NestedMenuItem[] = [
    // —— Workspace ——
    {
      title: t('sidebar.workspace'),
      items: [
        {
          title: t('dashboard.title'),
          icon: <LayoutDashboardIcon className='size-4 shrink-0' />,
          href: Routes.Dashboard,
          external: false,
        },
      ],
    },
    // —— Usage (every user) ——
    {
      title: t('sidebar.usage'),
      items: [
        {
          title: t('usage.title'),
          icon: <ActivityIcon className='size-4 shrink-0' />,
          href: Routes.DashboardUsage,
          external: false,
        },
        {
          title: t('sidebar.recharge'),
          icon: <WalletIcon className='size-4 shrink-0' />,
          href: Routes.SettingsRecharge,
          external: false,
        },
        {
          title: t('apiKeys.title'),
          icon: <KeyIcon className='size-4 shrink-0' />,
          href: Routes.ApiKeys,
          external: false,
        },
        {
          title: t('myFavorites.title'),
          icon: <HeartIcon className='size-4 shrink-0' />,
          href: Routes.MyFavorites,
          external: false,
        },
        {
          title: t('myDownloads.title'),
          icon: <DownloadIcon className='size-4 shrink-0' />,
          href: Routes.MyDownloads,
          external: false,
        },
        {
          title: t('myInstalls.title'),
          icon: <LayersIcon className='size-4 shrink-0' />,
          href: Routes.MyInstalls,
          external: false,
        },
      ],
    },
    // —— Publish (providers only) ——
    {
      title: t('sidebar.publish'),
      requireProvider: true,
      items: [
        {
          title: t('myAssets.mcp'),
          icon: <BotIcon className='size-4 shrink-0' />,
          href: Routes.MyAssetsMCP,
          external: false,
          requireProvider: true,
        },
        {
          title: t('myAssets.a2a'),
          icon: <SparklesIcon className='size-4 shrink-0' />,
          href: Routes.MyAssetsA2A,
          external: false,
          requireProvider: true,
        },
        {
          title: t('myAssets.skills'),
          icon: <LayersIcon className='size-4 shrink-0' />,
          href: Routes.MyAssetsSkills,
          external: false,
          requireProvider: true,
        },
        {
          title: t('earnings.title'),
          icon: <DollarSignIcon className='size-4 shrink-0' />,
          href: Routes.DashboardEarnings,
          external: false,
          requireProvider: true,
        },
        {
          title: t('sidebar.onboarding'),
          icon: <ShieldCheckIcon className='size-4 shrink-0' />,
          href: Routes.ProviderOnboarding,
          external: false,
          requireProvider: true,
        },
      ],
    },
  ]

  return links
}

/**
 * Sidebar config for the admin console, with translations applied.
 *
 * NOTICE: used in client components only
 */
export function getAdminSidebarLinks(): NestedMenuItem[] {
  const t = useTranslations('Dashboard')

  const links: NestedMenuItem[] = [
    {
      title: t('admin.title'),
      authorizeOnly: ['admin'],
      items: [
        {
          title: t('admin.payments.title'),
          icon: <CreditCardIcon className='size-4 shrink-0' />,
          href: Routes.AdminBankTransfers,
          external: false,
        },
      ],
    },
  ]

  return links
}
