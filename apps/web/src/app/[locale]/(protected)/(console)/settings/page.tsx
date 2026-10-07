'use client'

import { Card, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { cn } from '@workspace/ui/lib/utils'
import {
  BellIcon,
  Building2Icon,
  CircleUserRoundIcon,
  FileTextIcon,
  ReceiptIcon,
  SettingsIcon,
  WalletIcon,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { AvatarPreviewDialog } from '@/components/settings/profile/avatar-preview-dialog'
import { UpdateAvatarCard } from '@/components/settings/profile/update-avatar-card'
import { UpdateNameCard } from '@/components/settings/profile/update-name-card'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

const settingsSections = [{ id: 'account', labelKey: 'account', icon: CircleUserRoundIcon }] as const

type SettingsSectionId = (typeof settingsSections)[number]['id']

export default function SettingsPage() {
  const t = useTranslations('Dashboard.settings.hub')
  const tNotification = useTranslations('Dashboard.settings.notification')
  const searchParams = useSearchParams()
  const sectionParam = searchParams.get('section')
  const hasLegacySection = sectionParam === 'account'

  const [activeSection, setActiveSection] = useState<SettingsSectionId>('account')

  useEffect(() => {
    if (sectionParam && settingsSections.some((s) => s.id === sectionParam)) {
      setActiveSection(sectionParam as SettingsSectionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const selectSection = (id: SettingsSectionId) => {
    setActiveSection(id)
    const url = new URL(window.location.href)
    url.searchParams.set('section', id)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }]

  const landingCards = [
    {
      href: Routes.SettingsSetup,
      icon: SettingsIcon,
      title: t('cards.setup.title'),
      description: t('cards.setup.description'),
    },
    {
      href: Routes.SettingsProfile,
      icon: CircleUserRoundIcon,
      title: t('cards.profile.title'),
      description: t('cards.profile.description'),
    },
    {
      href: Routes.SettingsOrganization,
      icon: Building2Icon,
      title: t('cards.organization.title'),
      description: t('cards.organization.description'),
    },
    {
      href: Routes.SettingsInvoice,
      icon: FileTextIcon,
      title: t('cards.invoice.title'),
      description: t('cards.invoice.description'),
    },
    {
      href: Routes.SettingsRecharge,
      icon: WalletIcon,
      title: t('cards.recharge.title'),
      description: t('cards.recharge.description'),
    },
    {
      href: Routes.SettingsBills,
      icon: ReceiptIcon,
      title: t('cards.bills.title'),
      description: t('cards.bills.description'),
    },
    {
      href: Routes.SettingsNotifications,
      icon: BellIcon,
      title: tNotification('title'),
      description: tNotification('description'),
    },
  ]

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className='flex-1 px-gutter py-8 sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='mx-auto w-full max-w-page space-y-7'>
          <div>
            <h1 className='font-bold text-section tracking-tight'>{t('title')}</h1>
            <p className='mt-2 text-muted-foreground'>{t('subtitle')}</p>
          </div>

          {!hasLegacySection ? (
            <div className='grid gap-4 sm:grid-cols-2'>
              {landingCards.map((card) => (
                <LocaleLink key={card.href} href={card.href} className='group block'>
                  <Card className='h-full transition-colors group-hover:border-primary/40 group-hover:bg-muted/30'>
                    <CardHeader>
                      <div className='mb-2 flex size-9 items-center justify-center rounded-lg bg-secondary'>
                        <card.icon className='size-4' />
                      </div>
                      <CardTitle className='text-base'>{card.title}</CardTitle>
                      <CardDescription>{card.description}</CardDescription>
                    </CardHeader>
                  </Card>
                </LocaleLink>
              ))}
            </div>
          ) : (
            <div className='flex flex-col gap-6 md:flex-row'>
              <nav className='w-full shrink-0 space-y-1 md:w-48'>
                {settingsSections.map((section) => (
                  <button
                    key={section.id}
                    type='button'
                    onClick={() => selectSection(section.id)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      activeSection === section.id
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                    )}
                  >
                    <section.icon className='size-4' />
                    {t(section.labelKey)}
                  </button>
                ))}
              </nav>

              <div className='min-w-0 flex-1'>
                {activeSection === 'account' && (
                  <>
                    <div className='grid gap-4 md:grid-cols-2'>
                      <UpdateAvatarCard />
                      <UpdateNameCard />
                    </div>
                    <AvatarPreviewDialog />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
