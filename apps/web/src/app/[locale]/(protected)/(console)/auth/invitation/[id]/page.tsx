import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { isLocale } from '@/i18n/routing'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { AcceptInvitationForm } from './accept-invitation-form'

type PageProps = {
  params: Promise<{ locale: string; id: string }>
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale } = await params
  if (!isLocale(locale)) return undefined

  const t = await getTranslations({ locale, namespace: 'AuthPage.invitation' })
  return { title: t('title') }
}

/**
 * Target of the link in an organization invitation email.
 *
 * Sits under the protected layout, so a visitor without a session is sent to
 * sign-in first and returns here through `callbackUrl` — accepting requires the
 * invitee to be signed in, since the plugin compares the session address with
 * the invited one.
 */
export default async function AcceptInvitationPage({ params }: PageProps) {
  const { id } = await params
  const t = await getTranslations('AuthPage.invitation')

  return (
    <>
      <DashboardHeader breadcrumbs={[{ label: t('title'), isCurrentPage: true }]} />
      <div className="flex-1 px-5 py-8 sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-6 text-center">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">{t('description')}</p>
          </div>

          <AcceptInvitationForm invitationId={id} />
        </div>
      </div>
    </>
  )
}
