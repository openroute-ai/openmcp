'use client'

import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { authClient } from '@/lib/auth-client'
import { Routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

interface AccountInfoCardProps {
  className?: string
}

/**
 * Read-only account summary: email, phone, and quick links to security / payout.
 */
export function AccountInfoCard({ className }: AccountInfoCardProps) {
  const t = useTranslations('Dashboard.settings.profile.accountInfo')
  const { data: session } = authClient.useSession()
  const user = session?.user

  if (!user) {
    return null
  }

  const phone = (user as { phoneNumber?: string | null }).phoneNumber

  return (
    <Card className={cn('flex w-full max-w-lg flex-col overflow-hidden pt-6 md:max-w-xl', className)}>
      <CardHeader>
        <CardTitle className='font-semibold text-lg'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='space-y-1'>
          <p className='text-muted-foreground text-sm'>{t('email')}</p>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='font-medium'>{user.email || t('noEmail')}</p>
            {user.email ? (
              <Badge variant={user.emailVerified ? 'default' : 'secondary'}>
                {user.emailVerified ? t('verified') : t('unverified')}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className='space-y-1'>
          <p className='text-muted-foreground text-sm'>{t('phone')}</p>
          <p className='font-medium'>{phone || t('noPhone')}</p>
        </div>
        <div className='flex flex-wrap gap-2 pt-2'>
          <Button asChild variant='outline' size='sm'>
            <LocaleLink href={Routes.ProviderPayout}>{t('payoutAccount')}</LocaleLink>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
