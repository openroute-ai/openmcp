'use client'

import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'

interface PayoutEntryCardProps {
  className?: string
}

/**
 * Entry point to provider payout account settings (shown for providers).
 */
export function PayoutEntryCard({ className }: PayoutEntryCardProps) {
  const t = useTranslations('Dashboard.settings.profile.payoutEntry')
  const { data } = trpc.dashboard.getUserProviderStatus.useQuery()
  const isProvider = Boolean(data?.data?.isProvider)

  if (!isProvider) {
    return null
  }

  return (
    <Card className={cn('flex w-full max-w-lg flex-col overflow-hidden pt-6 md:max-w-xl', className)}>
      <CardHeader>
        <CardTitle className='font-semibold text-lg'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap gap-2'>
        <Button asChild>
          <LocaleLink href={Routes.ProviderPayout}>{t('manage')}</LocaleLink>
        </Button>
        <Button asChild variant='outline'>
          <LocaleLink href={Routes.DashboardEarnings}>{t('viewEarnings')}</LocaleLink>
        </Button>
      </CardContent>
    </Card>
  )
}
