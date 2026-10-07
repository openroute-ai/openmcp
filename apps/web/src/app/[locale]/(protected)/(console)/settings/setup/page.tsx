'use client'

import { Card, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { cn } from '@workspace/ui/lib/utils'
import {
  Building2Icon,
  IdCardIcon,
  ShieldCheckIcon,
  CircleUserRoundIcon,
  WalletIcon,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { IdentitySection } from '@/components/settings/setup/identity-section'
import { OrganizationContactCard } from '@/components/settings/organization-contact-card'
import { AvatarPreviewDialog } from '@/components/settings/profile/avatar-preview-dialog'
import { AccountInfoCard } from '@/components/settings/profile/account-info-card'
import { UpdateAvatarCard } from '@/components/settings/profile/update-avatar-card'
import { UpdateNameCard } from '@/components/settings/profile/update-name-card'
import { BindPhoneCard } from '@/components/settings/profile/security/bind-phone-card'
import { DeleteAccountCard } from '@/components/settings/profile/security/delete-account-card'
import { PasswordCardWrapper } from '@/components/settings/profile/security/password-card-wrapper'
import { UpdateEmailCard } from '@/components/settings/profile/security/update-email-card'
import { ProviderPayoutForm } from '@/components/provider/provider-payout-form'

/**
 * Everything about the account lives behind one left rail: profile, security,
 * identity, organization and payout. Each section swaps in place and is
 * mirrored to `?section=` so a refresh (or a shared link) lands on the same
 * tab — the pattern used by the geo-cms settings page.
 */
const settingsSections = [
  { id: 'profile', labelKey: 'profile', icon: CircleUserRoundIcon },
  { id: 'security', labelKey: 'security', icon: ShieldCheckIcon },
  { id: 'identity', labelKey: 'identity', icon: IdCardIcon },
  { id: 'organization', labelKey: 'organization', icon: Building2Icon },
  { id: 'payout', labelKey: 'payout', icon: WalletIcon },
] as const

type SettingsSectionId = (typeof settingsSections)[number]['id']

function isSettingsSection(id: string | null): id is SettingsSectionId {
  return id !== null && settingsSections.some((section) => section.id === id)
}

export default function SettingsSetupPage() {
  const t = useTranslations('Dashboard.settings.setup')
  const searchParams = useSearchParams()
  const sectionParam = searchParams.get('section')

  const [activeSection, setActiveSection] = useState<SettingsSectionId>('profile')

  useEffect(() => {
    if (isSettingsSection(sectionParam)) setActiveSection(sectionParam)
  }, [sectionParam])

  const selectSection = (id: SettingsSectionId) => {
    setActiveSection(id)
    const url = new URL(window.location.href)
    url.searchParams.set('section', id)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }]

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className='flex-1 px-gutter py-8 sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='mx-auto w-full max-w-page space-y-7'>
          <div>
            <h1 className='font-bold text-section tracking-tight'>{t('title')}</h1>
            <p className='mt-2 text-muted-foreground'>{t('subtitle')}</p>
          </div>

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
                  {t(`sections.${section.labelKey}`)}
                </button>
              ))}
            </nav>

            <div className='min-w-0 flex-1 space-y-6'>
              {activeSection === 'profile' && (
                <>
                  <div className='grid gap-4 md:grid-cols-2'>
                    <UpdateAvatarCard />
                    <UpdateNameCard />
                  </div>
                  <AccountInfoCard />
                  <AvatarPreviewDialog />
                </>
              )}

              {activeSection === 'security' && (
                <div className='space-y-6'>
                  <div className='grid gap-4 md:grid-cols-2'>
                    <UpdateEmailCard />
                    <BindPhoneCard />
                  </div>
                  <PasswordCardWrapper />
                  <DeleteAccountCard />
                </div>
              )}

              {activeSection === 'identity' && <IdentitySection />}

              {activeSection === 'organization' && <OrganizationContactCard />}

              {activeSection === 'payout' && <ProviderPayoutForm />}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
