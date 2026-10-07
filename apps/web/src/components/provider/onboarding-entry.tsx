'use client'

import { useTranslations } from 'next-intl'
import { Bot, Building2, CircleCheckBig, Clock3, Layers, Sparkles, UserRound } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { KycStatusBanner, StepIndicator, type KycEntityType } from './kyc-shared'
import { ProviderSubmitShell } from './provider-submit-shell'

type OnboardingProfile = {
  entityType?: string | null
  verificationStatus?: string | null
}

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

/** The three asset shelves a verified provider can open straight away. */
const ASSETS: { key: 'skills' | 'mcp' | 'a2a'; href: string; icon: typeof UserRound }[] = [
  { key: 'skills', href: Routes.MyAssetsSkills, icon: Layers },
  { key: 'mcp', href: Routes.MyAssetsMCP, icon: Bot },
  { key: 'a2a', href: Routes.MyAssetsA2A, icon: Sparkles },
]

function entityTypeOf(profile: OnboardingProfile | null | undefined): KycEntityType | undefined {
  if (profile?.entityType === 'individual' || profile?.entityType === 'company') {
    return profile.entityType
  }
  return undefined
}

/** Shown once verification passed: the type plus the three asset entries. */
function VerifiedNotice({ profile }: { profile: OnboardingProfile | null | undefined }) {
  const t = useTranslations('ProviderPage.kyc')
  const entityType = entityTypeOf(profile)

  return (
    <div className='space-y-6'>
      <Alert>
        <CircleCheckBig className='size-4 text-green-600' />
        <AlertTitle>{t('done.title')}</AlertTitle>
        {entityType && (
          <AlertDescription>{t('done.body', { type: t(`entry.${entityType}.title`) })}</AlertDescription>
        )}
      </Alert>

      <div className='grid gap-4 md:grid-cols-3'>
        {ASSETS.map(({ key, href, icon: Icon }) => (
          <LocaleLink
            key={key}
            href={href}
            className='group rounded-lg border p-6 transition-colors hover:border-primary'
          >
            <Icon className='mb-3 size-8 text-primary' />
            <h2 className='font-medium text-lg'>{t(`assets.${key}.title`)}</h2>
            <p className='mt-1 text-muted-foreground text-sm'>{t(`assets.${key}.description`)}</p>
          </LocaleLink>
        ))}
      </div>
    </div>
  )
}

/** Shown while the submission is in review: the status alone, nothing else. */
function ReviewingNotice({ profile }: { profile: OnboardingProfile | null | undefined }) {
  const t = useTranslations('ProviderPage.kyc')
  const entityType = entityTypeOf(profile)

  return (
    <Alert>
      <Clock3 className='size-4' />
      <AlertTitle>{t('reviewing.title')}</AlertTitle>
      {entityType && (
        <AlertDescription>{t('reviewing.body', { type: t(`entry.${entityType}.title`) })}</AlertDescription>
      )}
    </Alert>
  )
}

/** Lets a provider choose individual or company verification. */
export function OnboardingEntry() {
  const t = useTranslations('ProviderPage.kyc')
  const { data, isLoading } = trpc.providers.getMyProfile.useQuery(undefined, {
    retry: false,
  })
  const profile = data?.success === true ? data.data : undefined
  const status = profile?.verificationStatus

  if (isLoading) {
    return (
      <ProviderSubmitShell title={t('pageTitle')} description={t('pageDescription')}>
        <p className='text-muted-foreground'>{t('loading')}</p>
      </ProviderSubmitShell>
    )
  }

  // 提交审核这一步：审核中停在第 4 步并只给提示，已通过则四步全绿。
  if (status === 'pending' || status === 'verified') {
    return (
      <ProviderSubmitShell title={t('pageTitle')} description={t('pageDescription')}>
        <StepIndicator status={status} />
        {status === 'pending' ? (
          <ReviewingNotice profile={profile} />
        ) : (
          <VerifiedNotice profile={profile} />
        )}
      </ProviderSubmitShell>
    )
  }

  return (
    <ProviderSubmitShell title={t('pageTitle')} description={t('pageDescription')}>
      <div className='space-y-6'>
        {/* 还没选主体（含被驳回后回到起点），所以高亮第 1 步。 */}
        <StepIndicator step={0} />
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
    </ProviderSubmitShell>
  )
}
