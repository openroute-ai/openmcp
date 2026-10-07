import { useTranslations } from 'next-intl'
import { AccountInfoCard } from '@/components/settings/profile/account-info-card'
import { AvatarPreviewDialog } from '@/components/settings/profile/avatar-preview-dialog'
import { PayoutEntryCard } from '@/components/settings/profile/payout-entry-card'
import { DeleteAccountCard } from '@/components/settings/profile/security/delete-account-card'
import { PasswordCardWrapper } from '@/components/settings/profile/security/password-card-wrapper'
import { UpdateEmailCard } from '@/components/settings/profile/security/update-email-card'
import { UpdateAvatarCard } from '@/components/settings/profile/update-avatar-card'
import { UpdateNameCard } from '@/components/settings/profile/update-name-card'

export default function ProfilePage() {
  const t = useTranslations('Dashboard.settings')

  return (
    <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
      <div className='mx-auto w-full max-w-7xl space-y-7'>
        <div className='grid gap-8 md:grid-cols-2'>
          <UpdateAvatarCard />
          <UpdateNameCard />
          <AccountInfoCard />
          <PayoutEntryCard />
        </div>
        <AvatarPreviewDialog />

        <section className='space-y-6'>
          <div>
            <h2 className='font-bold text-2xl tracking-tight'>{t('security.title')}</h2>
            <p className='mt-1 text-muted-foreground'>{t('security.description')}</p>
          </div>

          <div className='grid grid-cols-1 gap-8'>
            <UpdateEmailCard />
            <PasswordCardWrapper />
            <DeleteAccountCard />
          </div>
        </section>
      </div>
    </div>
  )
}
