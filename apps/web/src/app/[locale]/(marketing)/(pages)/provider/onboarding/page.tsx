import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { assertLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { auth } from '@/lib/auth'
import { Routes } from '@/lib/routes'
import { OnboardingEntry } from '@/components/provider/onboarding-entry'
import { ProviderAuthGate } from '@/components/provider/provider-auth-gate'
import { ProviderSubmitShell } from '@/components/provider/provider-submit-shell'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const locale = assertLocale((await params).locale)
  const t = await getTranslations({ locale, namespace: 'ProviderPage.kyc' })

  return constructMetadata({
    title: t('meta.title'),
    description: t('meta.description'),
    canonicalUrl: getUrlWithLocale(Routes.ProviderOnboarding, locale),
    locale,
  })
}

export default async function ProviderOnboardingPage({
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
      `${getUrlWithLocale(Routes.Login, locale)}?callbackUrl=${encodeURIComponent(Routes.ProviderOnboarding)}`
    )
  }

  return (
    <ProviderAuthGate>
      <ProviderSubmitShell
        title={t('entry.pageTitle')}
        description={t('entry.pageDescription')}
        activeStep={2}
      >
        <OnboardingEntry />
      </ProviderSubmitShell>
    </ProviderAuthGate>
  )
}
