'use client'

import { cn } from '@workspace/ui/lib/utils'
import { CircleUserRoundIcon, ShieldCheckIcon } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AvatarPreviewDialog } from '@/components/settings/profile/avatar-preview-dialog'
import { AccountInfoCard } from '@/components/settings/profile/account-info-card'
import { UpdateAvatarCard } from '@/components/settings/profile/update-avatar-card'
import { UpdateNameCard } from '@/components/settings/profile/update-name-card'
import { DeleteAccountCard } from '@/components/settings/profile/security/delete-account-card'
import { PasswordCardWrapper } from '@/components/settings/profile/security/password-card-wrapper'
import { UpdateEmailCard } from '@/components/settings/profile/security/update-email-card'

/**
 * Admin account settings.
 *
 * `/admin/settings` is a sibling of the user console's settings page but without
 * the provider-facing surface (payout / organization). The admin layout already
 * provides the sidebar (`type='admin'`) and the padded content shell, so this
 * page deliberately uses plain `space-y-6` like the rest of the admin pages and
 * renders the shared profile/security cards unchanged.
 */
const sections = [
  { id: 'profile', label: '资料', icon: CircleUserRoundIcon },
  { id: 'security', label: '安全', icon: ShieldCheckIcon },
] as const

type SectionId = (typeof sections)[number]['id']

function isSection(id: string | null): id is SectionId {
  return id !== null && sections.some((section) => section.id === id)
}

export default function AdminSettingsPage() {
  const searchParams = useSearchParams()
  const [active, setActive] = useState<SectionId>('profile')

  useEffect(() => {
    const section = searchParams.get('section')
    if (isSection(section)) setActive(section)
  }, [searchParams])

  const select = (id: SectionId) => {
    setActive(id)
    const url = new URL(window.location.href)
    url.searchParams.set('section', id)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>账号设置</h1>
        <p className='mt-2 text-muted-foreground'>管理你的账户资料与安全选项</p>
      </div>

      <div className='flex flex-col gap-6 md:flex-row'>
        <nav className='w-full shrink-0 space-y-1 md:w-48'>
          {sections.map((section) => (
            <button
              key={section.id}
              type='button'
              onClick={() => select(section.id)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                active === section.id
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              )}
            >
              <section.icon className='size-4' />
              {section.label}
            </button>
          ))}
        </nav>

        <div className='min-w-0 flex-1 space-y-6'>
          {active === 'profile' && (
            <div className='space-y-6'>
              <div className='grid gap-4 md:grid-cols-2'>
                <UpdateAvatarCard />
                <UpdateNameCard />
              </div>
              <AccountInfoCard />
              <AvatarPreviewDialog />
            </div>
          )}

          {active === 'security' && (
            <div className='space-y-6'>
              <div className='grid gap-4 md:grid-cols-2'>
                <UpdateEmailCard />
              </div>
              <PasswordCardWrapper />
              <DeleteAccountCard />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}