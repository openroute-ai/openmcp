import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { assertLocale, isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { auth } from '@/lib/auth'
import { Routes } from '@/lib/routes'
import { ProviderAuthGate } from '@/components/provider/provider-auth-gate'
import { ProviderPayoutForm } from '@/components/provider/provider-payout-form'
import { ProviderSubmitGate } from '@/components/provider/provider-submit-gate'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'ProviderPage.payout' })

  return constructMetadata({
    title: t('meta.title'),
    description: t('meta.description'),
    canonicalUrl: getUrlWithLocale(Routes.ProviderPayout, locale),
    locale,
  })
}

export default async function ProviderPayoutPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = assertLocale((await params).locale)
  const t = await getTranslations({ locale, namespace: 'ProviderPage.payout' })

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    // Keep the locale on the sign-in page and return here afterwards.
    redirect(
      `${getUrlWithLocale(Routes.Login, locale)}?callbackUrl=${encodeURIComponent(Routes.ProviderPayout)}`
    )
  }

  return (
    <ProviderAuthGate>
      {/* Paid publishing needs a verified entity, so the gate comes first. */}
      <ProviderSubmitGate
        title={t('pageTitle')}
        description={t('pageDescription')}
      >
        <ProviderPayoutForm />
      </ProviderSubmitGate>
    </ProviderAuthGate>
  )
}
