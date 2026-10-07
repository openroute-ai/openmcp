'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { ProviderNotLogin } from './provider-not-login'

/**
 * Client-side guard for onboarding sub-pages: shows the sign-in prompt until a
 * session exists. The server page still performs its own session check.
 */
export function ProviderAuthGate({ children }: { children: ReactNode }) {
  const t = useTranslations('ProviderPage.authGate')
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
        <div className='mx-auto w-full max-w-7xl px-5 py-6 sm:px-6 lg:px-10'>
          <p className='text-muted-foreground'>{t('loading')}</p>
        </div>
    )
  }

  if (!session?.user) {
    return <ProviderNotLogin />
  }

  return (
      <div className='mx-auto w-full max-w-7xl px-5 py-6 sm:px-6 lg:px-10'>
        <div className='mx-auto max-w-5xl space-y-6'>{children}</div>
      </div>
  )
}

