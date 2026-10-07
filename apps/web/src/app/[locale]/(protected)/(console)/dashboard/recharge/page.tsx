import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { LoginWrapper } from '@/components/auth/login-wrapper'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { Card, CardContent } from '@workspace/ui/components/card'
import { getTranslations } from 'next-intl/server'
import { RechargeClient } from '@/components/recharge/recharge-client'

export const dynamic = 'force-dynamic'

/**
 * Wallet top-up. Requires a session: every order is created against
 * `session.user.id` server-side, so there is no anonymous entry point.
 */
export default async function RechargePage() {
  const t = await getTranslations('RechargePage')
  const tDashboard = await getTranslations('Dashboard')
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    return (
      <>
        <DashboardHeader
          breadcrumbs={[
            { label: tDashboard('dashboard.title'), href: '/dashboard' },
            { label: t('title'), isCurrentPage: true },
          ]}
        />
        <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
          <div className='mx-auto w-full max-w-7xl space-y-7'>
            <Card>
              <CardContent className='pt-6'>
                <p className='text-muted-foreground mb-4 text-sm'>{t('signInRequired')}</p>
                <LoginWrapper callbackUrl='/dashboard/recharge'>
                  <span className='text-primary underline underline-offset-4'>
                    {t('title')}
                  </span>
                </LoginWrapper>
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    )
  }

  return <RechargeClient />
}
