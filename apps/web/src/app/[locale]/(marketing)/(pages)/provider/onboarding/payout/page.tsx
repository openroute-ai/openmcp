import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { assertLocale, isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { auth } from '@/lib/auth'
import { Routes } from '@/lib/routes'
import { StepIndicator } from '@/components/provider/kyc-shared'
import { OnboardingPayoutStep } from '@/components/provider/onboarding-payout-step'
import { ProviderAuthGate } from '@/components/provider/provider-auth-gate'
import { ProviderSubmitShell } from '@/components/provider/provider-submit-shell'

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
    title: t('payoutStep.meta.title'),
    description: t('payoutStep.meta.description'),
    canonicalUrl: getUrlWithLocale(Routes.ProviderOnboardingPayout, locale),
    locale,
  })
}

export default async function ProviderOnboardingPayoutPage({
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
      `${getUrlWithLocale(Routes.Login, locale)}?callbackUrl=${encodeURIComponent(Routes.ProviderOnboardingPayout)}`
    )
  }

  return (
    <ProviderAuthGate>
      <ProviderSubmitShell
        title={t('payoutStep.pageTitle')}
        description={t('payoutStep.pageDescription')}
      >
        <StepIndicator step={2} />
        <OnboardingPayoutStep />
      </ProviderSubmitShell>
    </ProviderAuthGate>
  )
}
