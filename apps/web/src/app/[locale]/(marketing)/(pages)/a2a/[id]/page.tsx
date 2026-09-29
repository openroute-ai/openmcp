import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { a2aAgentsDataAccess } from '@/web/a2a-agents'
import { A2aDetailPageClient } from './a2a-detail-page-client'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; locale: string }>
}): Promise<Metadata | undefined> {
  const { id, locale: raw } = await params
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'A2APage.meta' })

  const agent = await a2aAgentsDataAccess.getAgentById(id)

  if (!agent) {
    return constructMetadata({
      title: t('notFoundTitle'),
      description: t('notFoundDescription'),
      canonicalUrl: getUrlWithLocale(`/a2a/${id}`, locale),
      locale,
    })
  }

  const description =
    (locale === 'zh' ? agent.description : agent.descriptionEn) ||
    t('detailFallbackDescription', { name: agent.name })

  return constructMetadata({
    title: `${agent.name} - ${t('detailTitleSuffix')}`,
    description: description.substring(0, 160),
    canonicalUrl: getUrlWithLocale(`/a2a/${agent.slug || agent.id}`, locale),
    image: agent.logoUrl ?? undefined,
    keywords: ['A2A', 'Agent', 'AI Agent', 'Agent Card', agent.name],
    locale,
  })
}

export default function A2aDetailPage() {
  return <A2aDetailPageClient />
}
