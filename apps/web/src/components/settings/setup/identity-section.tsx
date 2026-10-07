'use client'

import { Skeleton } from '@workspace/ui/components/skeleton'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { KycCompanyForm } from '@/components/provider/kyc-company-form'
import { KycIndividualForm } from '@/components/provider/kyc-individual-form'

/**
 * Identity section of the unified settings page.
 *
 * Which form shows is decided by the subject already on file: a company
 * subject edits company KYC, everyone else individual KYC. No profile at all
 * means the user has not started onboarding, so the section offers the two
 * entry points instead of an empty form.
 */
export function IdentitySection() {
  const t = useTranslations('Dashboard.settings.setup.identity')
  const { data, isLoading } = trpc.providers.getMyProfile.useQuery(undefined, { retry: false })

  if (isLoading) {
    return <Skeleton className='h-64 w-full' />
  }

  const profile = data?.success ? data.data : null

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap gap-2'>
          <Button asChild>
            <LocaleLink href={Routes.ProviderOnboardingIndividual}>{t('goIndividual')}</LocaleLink>
          </Button>
          <Button asChild variant='outline'>
            <LocaleLink href={Routes.ProviderOnboardingCompany}>{t('goCompany')}</LocaleLink>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return profile.entityType === 'company' ? <KycCompanyForm /> : <KycIndividualForm />
}
