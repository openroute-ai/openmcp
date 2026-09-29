import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { Audience } from './components/audience'
import { CapabilityCarousel } from './components/capability-carousel'
import { CapabilityList } from './components/capability-list'
import { Hero } from './components/hero'
import { Metrics } from './components/metrics'
import { Onboarding } from './components/onboarding'
import { OpenpayHomeCta } from './components/openpay-home-cta'
import { ProtocolShowcase } from './components/protocol-showcase'
import { PublishTrusted } from './components/publish-trusted'
import { RevenueCta } from './components/revenue-cta'

/**
 * https://next-intl.dev/docs/environments/actions-metadata-route-handlers#metadata-api
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'HomePage' })

  return constructMetadata({
    title: t('title'),
    description: t('description'),
    canonicalUrl: getUrlWithLocale('', locale),
    locale,
  })
}

export default function HomePage() {
  return (
    <div className='flex flex-col'>
      <Hero />
      <CapabilityCarousel />
      <CapabilityList />
      <ProtocolShowcase />
      <PublishTrusted />
      <Metrics />
      <RevenueCta />
      <OpenpayHomeCta />
      <Audience />
      <Onboarding />
    </div>
  )
}
