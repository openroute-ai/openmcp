'use client'

import { useTranslations } from 'next-intl'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { OrganizationContactCard } from '@/components/settings/organization-contact-card'

export default function OrganizationPage() {
  const t = useTranslations('Dashboard.organization')

  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }]

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />
      <div className='flex-1 px-gutter py-8 sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='mx-auto w-full max-w-page space-y-7'>
          <div>
            <h1 className='font-bold text-section tracking-tight'>{t('title')}</h1>
            <p className='mt-2 text-muted-foreground'>{t('description')}</p>
          </div>

          <OrganizationContactCard />
        </div>
      </div>
    </>
  )
}
