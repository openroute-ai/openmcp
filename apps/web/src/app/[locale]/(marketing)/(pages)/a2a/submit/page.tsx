import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { A2aSubmitForm } from '@/components/a2a-agents/a2a-submit-form'
import { ProviderNotLogin } from '@/components/provider/provider-not-login'
import { ProviderSubmitGate } from '@/components/provider/provider-submit-gate'
import { isLocale } from '@/i18n/routing'
import { auth } from '@/lib/auth'
import { constructMetadata } from '@/lib/metadata'
import { Routes } from '@/lib/routes'
import { getUrlWithLocale } from '@/lib/urls/urls'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'A2ASubmit.meta' })

  return constructMetadata({
    title: t('title'),
    description: t('description'),
    canonicalUrl: getUrlWithLocale(Routes.A2ASubmit, locale),
    keywords: ['A2A', 'Agent', 'AI Agent', 'Agent Card', 'publish', 'provider'],
    locale,
  })
}

export default async function A2aSubmitPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-page px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
          <ProviderNotLogin />
        </div>
      </div>
    )
  }

  const t = await getTranslations('A2ASubmit')

  return (
    <ProviderSubmitGate title={t('cardTitle')} description={t('cardDescription')}>
      <A2aSubmitForm />
    </ProviderSubmitGate>
  )
}
