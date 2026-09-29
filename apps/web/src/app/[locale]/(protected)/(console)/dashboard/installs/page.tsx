import type { Metadata } from 'next'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { SkillInstallsList } from '@/components/dashboard/skill-installs-list'
import { getTranslations } from 'next-intl/server'
import { assertLocale, isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'Dashboard.myInstalls' })

  return constructMetadata({
    title: t('title'),
    description: t('description'),
    canonicalUrl: getUrlWithLocale('/dashboard/installs', locale),
    noIndex: true,
    locale,
  })
}

export default async function InstallsPage({ params }: PageProps) {
  const locale = assertLocale((await params).locale)
  const t = await getTranslations({ locale, namespace: 'Dashboard.myInstalls' })
  const tDashboard = await getTranslations({ locale, namespace: 'Dashboard' })

  const breadcrumbs = [
    {
      label: tDashboard('dashboard.title'),
      href: '/dashboard',
    },
    {
      label: t('title'),
      isCurrentPage: true,
    },
  ]

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />
      <div className='mx-auto flex w-full max-w-page flex-1 flex-col px-gutter sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='@container/main flex flex-1 flex-col gap-2'>
          <div className='flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6'>
            <div>
              <h1 className='mb-2 font-bold text-2xl'>{t('title')}</h1>
              <p className='text-muted-foreground'>{t('description')}</p>
            </div>
            <SkillInstallsList />
          </div>
        </div>
      </div>
    </>
  )
}
