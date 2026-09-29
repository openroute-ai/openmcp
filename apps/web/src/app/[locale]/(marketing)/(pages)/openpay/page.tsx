import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { OpenpayCapabilities } from './components/openpay-capabilities'
import { OpenpayCases } from './components/openpay-cases'
import { OpenpayComparison } from './components/openpay-comparison'
import { OpenpayCta } from './components/openpay-cta'
import { OpenpayFaq } from './components/openpay-faq'
import { OpenpayHero } from './components/openpay-hero'
import { OpenpaySteps } from './components/openpay-steps'

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
  const t = await getTranslations({ locale, namespace: 'OpenPayPage.meta' })

  return constructMetadata({
    title: t('title'),
    description: t('description'),
    canonicalUrl: getUrlWithLocale('/openpay', locale),
    keywords: ['OpenPay', 'pay skill', 'paid skill', 'skill monetization', 'WeChat Pay', 'Alipay'],
    locale,
  })
}

export default function OpenpayPage() {
  return (
    <main className='flex-1'>
      <OpenpayHero />
      <OpenpayComparison />
      <OpenpayCapabilities />
      <OpenpayCases />
      <OpenpaySteps />
      <OpenpayFaq />
      <OpenpayCta />
    </main>
  )
}
