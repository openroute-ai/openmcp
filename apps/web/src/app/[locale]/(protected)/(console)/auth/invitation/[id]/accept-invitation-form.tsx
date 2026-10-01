'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { useLocaleRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { acceptInvitationAction } from '@/server/actions/organizations'
import { Routes } from '@/lib/routes'

interface AcceptInvitationFormProps {
  invitationId: string
}

/**
 * One-shot accept button for the link in the invitation email.
 *
 * Deliberately does not auto-submit on mount: joining an organization changes
 * who can see the account's resources, so it takes an explicit click.
 */
export function AcceptInvitationForm({ invitationId }: AcceptInvitationFormProps) {
  const t = useTranslations('AuthPage.invitation')
  const localeRouter = useLocaleRouter()
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onAccept() {
    setStatus('pending')

    const result = await acceptInvitationAction(invitationId)

    if (result.success) {
      setStatus('done')
      toast.success(t('accepted'))
      router.refresh()
      localeRouter.push(Routes.Dashboard)
      return
    }

    setStatus('failed')
    // The action's message is Better Auth's own wording, which is not
    // translated; the page shows the localized copy instead.
    setError(result.error)
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {status === 'failed' ? (
        <>
          <p className="text-sm text-destructive">{t('failed')}</p>
          <Button variant="outline" onClick={() => router.refresh()}>
            {t('goToDashboard')}
          </Button>
        </>
      ) : status === 'done' ? (
        <p className="text-sm text-muted-foreground">{t('accepted')}</p>
      ) : (
        <Button
          onClick={onAccept}
          disabled={status === 'pending'}
          className="w-full cursor-pointer sm:w-auto"
        >
          {status === 'pending' && <Spinner />}
          {status === 'pending' ? t('accepting') : t('accept')}
        </Button>
      )}
    </div>
  )
}
