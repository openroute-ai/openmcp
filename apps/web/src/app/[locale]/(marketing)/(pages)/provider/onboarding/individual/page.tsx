import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { assertLocale, isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { auth } from '@/lib/auth'
import { Routes } from '@/lib/routes'
import { KycIndividualForm } from '@/components/provider/kyc-individual-form'
import { ProviderAuthGate } from '@/components/provider/provider-auth-gate'
import { ProviderSubmitShell } from '@/components/provider/provider-submit-shell'
import { StepIndicator } from '@/components/provider/kyc-shared'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'ProviderPage.kyc' })

  return constructMetadata({
    title: t('individual.meta.title'),
    description: t('individual.meta.description'),
    canonicalUrl: getUrlWithLocale(Routes.ProviderOnboardingIndividual, locale),
    locale,
  })
}

export default async function ProviderOnboardingIndividualPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = assertLocale((await params).locale)
  const t = await getTranslations({ locale, namespace: 'ProviderPage.kyc' })

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    // Keep the locale on the sign-in page and return here afterwards.
    redirect(
      `${getUrlWithLocale(Routes.Login, locale)}?callbackUrl=${encodeURIComponent(Routes.ProviderOnboardingIndividual)}`
    )
  }

  return (
    <ProviderAuthGate>
      <ProviderSubmitShell
        title={t('individual.pageTitle')}
        description={t('individual.pageDescription')}
      >
        <StepIndicator step={1} />
        <KycIndividualForm />
      </ProviderSubmitShell>
    </ProviderAuthGate>
  )
}
