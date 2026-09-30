'use client'

import { useTranslations } from 'next-intl'
import { Routes } from '@/lib/routes'
import type { NestedMenuItem } from '@/lib/types'

/**
 * Get navbar config with translations
 *
 * NOTICE: used in client components only
 *
 * docs:
 * https://openroute.cn/docs/config/navbar
 *
 * @returns The navbar config with translated titles and descriptions
 */
export function getNavbarLinks(): NestedMenuItem[] {
  const t = useTranslations('Marketing.navbar')

  return [
    {
      title: t('skills.title'),
      href: Routes.Skills,
      external: false,
    },
    {
      title: t('mcp.title'),
      href: Routes.MCP,
      external: false,
    },
    {
      title: t('a2a.title'),
      href: Routes.A2A,
      external: false,
    },
    {
      title: t('personas.title'),
      href: Routes.Personas,
      external: false,
    },
    {
      title: t('rankings.title'),
      href: Routes.Rankings,
      external: false,
    },
    {
      title: t('openpay.title'),
      href: Routes.OpenPay,
      external: false,
    },
    {
      title: t('blog.title'),
      href: Routes.Blog,
      external: false,
    },
    {
      title: t('docs.title'),
      href: Routes.Docs,
      external: false,
    },
  ]
}
