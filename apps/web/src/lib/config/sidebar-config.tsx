'use client'

import {
  ActivityIcon,
  BotIcon,
  CreditCardIcon,
  DollarSignIcon,
  DownloadIcon,
  HeartIcon,
  InboxIcon,
  KeyIcon,
  LayersIcon,
  LayoutDashboardIcon,
  MailIcon,
  MonitorIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Routes, adminRoutes } from '@/lib/routes'
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
 * Only routes backed by a real page and a real `adminProcedure` are listed.
 * Entries such as sessions, security review and user submissions stay out
 * until their routers land, because a dead link is worse than a missing one.
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
          title: t('admin.users.title'),
          icon: <UsersIcon className='size-4 shrink-0' />,
          href: Routes.AdminUsers,
          external: false,
        },
        {
          title: t('admin.sessions.title'),
          icon: <MonitorIcon className='size-4 shrink-0' />,
          href: Routes.AdminSessions,
          external: false,
        },
        {
          title: t('admin.userSubmissions.title'),
          icon: <InboxIcon className='size-4 shrink-0' />,
          href: Routes.AdminUserSubmissions,
          external: false,
        },
        {
          title: t('admin.securityReview.title'),
          icon: <ShieldAlertIcon className='size-4 shrink-0' />,
          href: Routes.AdminSecurityReview,
          external: false,
        },
        {
          title: t('admin.newsletterSubscriptions.title'),
          icon: <MailIcon className='size-4 shrink-0' />,
          href: Routes.AdminNewsletterSubscriptions,
          external: false,
        },
        {
          title: t('admin.rechargeOrders.title'),
          icon: <CreditCardIcon className='size-4 shrink-0' />,
          href: Routes.AdminRechargeOrders,
          external: false,
        },
        {
          title: t('admin.payments.title'),
          icon: <DollarSignIcon className='size-4 shrink-0' />,
          href: Routes.AdminBankTransfers,
          external: false,
        },
        {
          title: t('admin.workflows.title'),
          icon: <LayersIcon className='size-4 shrink-0' />,
          href: Routes.AdminWorkflows,
          external: false,
        },
        {
          title: t('admin.categories.title'),
          icon: <ActivityIcon className='size-4 shrink-0' />,
          href: Routes.AdminCategories,
          external: false,
        },
        {
          title: t('admin.authors.title'),
          icon: <KeyIcon className='size-4 shrink-0' />,
          href: Routes.AdminAuthors,
          external: false,
        },
        {
          title: t('admin.mcpServers.title'),
          icon: <BotIcon className='size-4 shrink-0' />,
          href: Routes.AdminMcpServers,
          external: false,
        },
        {
          title: t('admin.a2aAgents.title'),
          icon: <SparklesIcon className='size-4 shrink-0' />,
          href: Routes.AdminA2aAgents,
          external: false,
        },
        {
          title: t('admin.providerApplications.title'),
          icon: <ShieldCheckIcon className='size-4 shrink-0' />,
          href: Routes.AdminProviderApplications,
          external: false,
        },
        {
          title: t('admin.providerPayouts.title'),
          icon: <WalletIcon className='size-4 shrink-0' />,
          href: Routes.AdminProviderPayouts,
          external: false,
        },
      ],
    },
  ]

  // Every admin sidebar entry must point at a route in `adminRoutes`. The two
  // lists are maintained separately (one carries icons and labels, the other is
  // data the proxy and admin layout rely on), so fail loudly in development if
  // an admin page lands in one and is forgotten in the other.
  if (process.env.NODE_ENV === 'development') {
    const known = new Set<string>(adminRoutes)
    const missing = links
      .flatMap((group) => group.items ?? [])
      .flatMap((item) => (item.href ? [item.href] : []))
      .filter((href) => !known.has(href))
    if (missing.length > 0) {
      console.error(
        '[sidebar] admin links missing from adminRoutes in lib/routes.ts:',
        missing.join(', ')
      )
    }
  }

  return links
}
