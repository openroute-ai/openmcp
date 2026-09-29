'use client'

import { useTranslations } from 'next-intl'
import { Building2, UserRound } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { KycStatusBanner, StepIndicator, type KycEntityType } from './kyc-shared'

const ENTITIES: { key: KycEntityType; href: string; icon: typeof UserRound }[] = [
  {
    key: 'individual',
    href: Routes.ProviderOnboardingIndividual,
    icon: UserRound,
  },
  {
    key: 'company',
    href: Routes.ProviderOnboardingCompany,
    icon: Building2,
  },
]

/** Lets a provider choose individual or company verification. */
export function OnboardingEntry() {
  const t = useTranslations('ProviderPage.kyc')
  const { data, isLoading } = trpc.providers.getMyProfile.useQuery(undefined, {
    retry: false,
  })
  const profile = data?.success === true ? data.data : undefined

  if (isLoading) return null

  return (
    <div className='space-y-6'>
      <StepIndicator status={profile?.verificationStatus} />
      <KycStatusBanner profile={profile} />

      <Card>
        <CardHeader>
          <CardTitle>{t('entry.title')}</CardTitle>
          <CardDescription>{t('entry.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid gap-4 md:grid-cols-2'>
            {ENTITIES.map(({ key, href, icon: Icon }) => (
              <LocaleLink
                key={key}
                href={href}
                className='group rounded-lg border p-6 transition-colors hover:border-primary'
              >
                <Icon className='mb-3 size-8 text-primary' />
                <h2 className='flex items-center gap-2 font-medium text-lg'>
                  {t(`entry.${key}.title`)}
                </h2>
                <p className='mt-1 text-muted-foreground text-sm'>
                  {t(`entry.${key}.description`)}
                </p>
                <p className='mt-2 text-muted-foreground text-xs'>{t(`entry.${key}.detail`)}</p>
              </LocaleLink>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
