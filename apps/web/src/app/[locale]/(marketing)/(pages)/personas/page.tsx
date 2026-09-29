import type { Metadata } from 'next'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { PersonasPageClient } from './personas-page-client'

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const search = await searchParams
  const searchQuery = typeof search.search === 'string' ? search.search : undefined

  const title = searchQuery
    ? locale === 'zh'
      ? `搜索"${searchQuery}" - 虚拟员工角色`
      : `Search "${searchQuery}" - Personas`
    : locale === 'zh'
      ? '虚拟员工角色（Personas） - 探索角色库'
      : 'Personas - Explore Virtual Employee Roles'

  const description =
    locale === 'zh'
      ? '浏览由多技能与 Prompt 组成的虚拟员工角色，开箱即用'
      : 'Browse virtual employee roles composed of skills and prompts, ready to use'

  return constructMetadata({
    title,
    description,
    canonicalUrl: getUrlWithLocale('/personas', locale),
    keywords: ['Persona', '虚拟员工', 'AI 角色'],
    locale,
  })
}

export default function PersonasPage() {
  return <PersonasPageClient />
}
