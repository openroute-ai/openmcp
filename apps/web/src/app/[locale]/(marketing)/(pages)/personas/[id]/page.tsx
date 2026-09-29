import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { personasDataAccess } from '@/web/personas'
import { PersonaDetailPageClient } from './persona-detail-page-client'

/**
 * https://next-intl.dev/docs/environments/actions-metadata-route-handlers#metadata-api
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; locale: string }>
}): Promise<Metadata | undefined> {
  const { id, locale: raw } = await params
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'PersonaPage.meta' })
  const lang = locale === 'zh' ? 'zh' : 'en'

  // Slugs are the canonical public identifier, so accept either form.
  let persona = await personasDataAccess.getPersonaById(id, lang)
  if (!persona) {
    persona = await personasDataAccess.getPersonaBySlug(id, lang)
  }

  if (!persona) {
    return constructMetadata({
      title: t('notFoundTitle'),
      description: t('notFoundDescription'),
      canonicalUrl: getUrlWithLocale(`/personas/${id}`, locale),
      locale,
    })
  }

  const description =
    persona.description || t('detailFallbackDescription', { name: persona.title })

  return constructMetadata({
    title: `${persona.title} - ${t('detailTitleSuffix')}`,
    description: description.substring(0, 160),
    canonicalUrl: getUrlWithLocale(`/personas/${persona.slug}`, locale),
    image: persona.imageUrl ?? undefined,
    keywords: ['Persona', 'AI role', 'virtual employee', persona.title],
    locale,
  })
}

export default function PersonaDetailPage() {
  return <PersonaDetailPageClient />
}
