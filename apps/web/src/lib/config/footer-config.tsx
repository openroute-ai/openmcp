'use client'

import { useTranslations } from 'next-intl'
import { Routes } from '@/lib/routes'
import type { NestedMenuItem } from '@/lib/types'

/**
 * Get footer config with translations
 *
 * NOTICE: used in client components only
 *
 * docs:
 * https://openroute.cn/docs/config/footer
 *
 * @returns The footer config with translated titles
 */
export function getFooterLinks(): NestedMenuItem[] {
  const t = useTranslations('Marketing.footer')

  return [
    {
      title: t('product.title'),
      items: [
        {
          title: t('product.items.skills'),
          href: Routes.Skills,
          external: false,
        },
        {
          title: t('product.items.mcp'),
          href: Routes.MCP,
          external: false,
        },
        {
          title: t('product.items.a2a'),
          href: Routes.A2A,
          external: false,
        },
        {
          title: t('product.items.personas'),
          href: Routes.Personas,
          external: false,
        },
        {
          title: t('product.items.start'),
          href: Routes.Start,
          external: false,
        },
      ],
    },
    {
      title: t('resources.title'),
      items: [
        {
          title: t('resources.items.blog'),
          href: Routes.Blog,
          external: false,
        },
        {
          title: t('resources.items.guide'),
          href: Routes.UserGuide,
          external: false,
        },
        {
          title: t('resources.items.docs'),
          href: Routes.Docs,
          external: false,
        },
        {
          title: t('resources.items.changelog'),
          href: Routes.Changelog,
          external: false,
        },
        {
          title: t('resources.items.roadmap'),
          href: Routes.Roadmap,
          external: true,
        },
      ],
    },
    {
      title: t('company.title'),
      items: [
        {
          title: t('company.items.about'),
          href: Routes.About,
          external: false,
        },
        {
          title: t('company.items.contact'),
          href: Routes.Contact,
          external: false,
        },
        {
          title: t('company.items.waitlist'),
          href: Routes.Waitlist,
          external: false,
        },
      ],
    },
    {
      title: t('legal.title'),
      items: [
        {
          title: t('legal.items.cookiePolicy'),
          href: Routes.CookiePolicy,
          external: false,
        },
        {
          title: t('legal.items.privacyPolicy'),
          href: Routes.PrivacyPolicy,
          external: false,
        },
        {
          title: t('legal.items.termsOfService'),
          href: Routes.TermsOfService,
          external: false,
        },
      ],
    },
  ]
}
