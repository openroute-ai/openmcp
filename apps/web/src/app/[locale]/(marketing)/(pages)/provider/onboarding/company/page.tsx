import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { assertLocale, isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { auth } from '@/lib/auth'
import { Routes } from '@/lib/routes'
import { KycCompanyForm } from '@/components/provider/kyc-company-form'
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
    title: t('company.meta.title'),
    description: t('company.meta.description'),
    canonicalUrl: getUrlWithLocale(Routes.ProviderOnboardingCompany, locale),
    locale,
  })
}

export default async function ProviderOnboardingCompanyPage({
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
      `${getUrlWithLocale(Routes.Login, locale)}?callbackUrl=${encodeURIComponent(Routes.ProviderOnboardingCompany)}`
    )
  }

  return (
    <ProviderAuthGate>
      <ProviderSubmitShell
        title={t('company.pageTitle')}
        description={t('company.pageDescription')}
      >
        <StepIndicator step={1} />
        <KycCompanyForm />
      </ProviderSubmitShell>
    </ProviderAuthGate>
  )
}
