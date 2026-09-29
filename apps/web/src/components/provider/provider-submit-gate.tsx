'use client'

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@workspace/ui/components/alert'
import { BadgeCheck, Clock3, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'
import { Routes } from '@/lib/routes'
import { ProviderSubmitShell } from './provider-submit-shell'

type ProviderSubmitGateProps = {
  title: string
  description: string
  children: ReactNode
}

/**
 * Shared gate for the publish pages: after sign-in, only a verified provider
 * sees the form. A missing payout channel is surfaced as a warning because the
 * server enforces it for paid assets.
 */
export function ProviderSubmitGate({ title, description, children }: ProviderSubmitGateProps) {
  const t = useTranslations('ProviderPage.gate')
  const { data, isLoading, isError, refetch } = trpc.providers.getMyProfile.useQuery(undefined, {
    retry: false,
  })

  if (isLoading) {
    return (
      <ProviderSubmitShell title={title} description={description} activeStep={2}>
        <p className='text-muted-foreground'>{t('loading')}</p>
      </ProviderSubmitShell>
    )
  }

  if (isError || data?.success === false) {
    return (
      <ProviderSubmitShell title={title} description={description} activeStep={2}>
        <Alert variant='destructive'>
          <AlertTitle>{t('statusErrorTitle')}</AlertTitle>
          <AlertDescription className='flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <span>{t('statusErrorHint')}</span>
            <button type='button' onClick={() => refetch()} className='shrink-0 underline underline-offset-4'>
              {t('retry')}
            </button>
          </AlertDescription>
        </Alert>
      </ProviderSubmitShell>
    )
  }

  const profile = data?.data ?? null
  const status = profile?.verificationStatus
  const payReady = profile?.payChannelStatus === 'ready'

  if (!profile || status === 'unverified' || status === 'rejected') {
    return (
      <ProviderSubmitShell title={title} description={description} activeStep={2}>
        <div className='space-y-4 rounded-lg border border-border bg-card p-6'>
          <div className='flex items-center gap-2'>
            <ShieldAlert className='size-5 text-amber-600' />
            <h2 className='font-semibold text-lg'>
              {status === 'rejected' ? t('rejectedTitle') : t('needVerifyTitle')}
            </h2>
          </div>
          <p className='text-muted-foreground text-sm'>{t('needVerifyHint')}</p>
          {status === 'rejected' && profile?.verificationNote && (
            <Alert variant='destructive'>
              <AlertTitle>{t('rejectionReason')}</AlertTitle>
              <AlertDescription>{profile.verificationNote}</AlertDescription>
            </Alert>
          )}
          <LocaleLink
            href={Routes.ProviderOnboarding}
            className='inline-flex h-10 items-center rounded-lg bg-primary px-6 font-medium text-primary-foreground'
          >
            {t('goVerify')}
          </LocaleLink>
        </div>
      </ProviderSubmitShell>
    )
  }

  if (status === 'pending') {
    return (
      <ProviderSubmitShell title={title} description={description} activeStep={2}>
        <div className='space-y-4 rounded-lg border border-border bg-card p-6'>
          <div className='flex items-center gap-2'>
            <Clock3 className='size-5 text-primary' />
            <h2 className='font-semibold text-lg'>{t('pendingTitle')}</h2>
          </div>
          <p className='text-muted-foreground text-sm'>{t('pendingHint')}</p>
          <LocaleLink
            href={Routes.ProviderOnboarding}
            className='inline-flex h-10 items-center rounded-lg border border-border px-6 font-medium'
          >
            {t('viewStatus')}
          </LocaleLink>
        </div>
      </ProviderSubmitShell>
    )
  }

  return (
    <ProviderSubmitShell title={title} description={description} activeStep={3}>
      {!payReady ? (
        <Alert>
          <TriangleAlert className='size-4' />
          <AlertTitle>{t('payMissingTitle')}</AlertTitle>
          <AlertDescription className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <span>{t('payMissingHint')}</span>
            <LocaleLink
              href={Routes.ProviderPayout}
              className='shrink-0 font-medium underline underline-offset-4'
            >
              {t('bindPayout')}
            </LocaleLink>
          </AlertDescription>
        </Alert>
      ) : (
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          <BadgeCheck className='size-4 text-green-600' />
          {t('verifiedLabel')}
          {profile.payChannelType && profile.payChannelType !== 'none'
            ? ` · ${t(`payChannels.${profile.payChannelType}`)}`
            : null}
        </div>
      )}
      {children}
    </ProviderSubmitShell>
  )
}
