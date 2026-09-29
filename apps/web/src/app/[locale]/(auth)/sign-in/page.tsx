import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { UnifiedLoginForm } from '@/components/auth/unified-login-form'
import { requireUnauth } from '@/lib/server/auth-utils'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'Sign In',
}

export default async function SignInPage() {
  // A visitor who already has a valid session has no business on this page.
  await requireUnauth(Routes.Dashboard)
  const t = await getTranslations('AuthPage.common')

  return (
    // The form reads `callbackUrl` with useSearchParams, which opts the route
    // out of static rendering unless it is wrapped in a Suspense boundary.
    <Suspense fallback={null}>
      <main className="flex w-full max-w-md flex-col gap-6 px-4 py-6 sm:px-6">
        <UnifiedLoginForm className="w-full shadow-sm" />

        <p className="text-balance text-center text-xs leading-relaxed text-muted-foreground">
          {t('byClickingContinue')}
          <LocaleLink
            href={Routes.TermsOfService}
            className="underline underline-offset-4 hover:text-primary"
          >
            {t('termsOfService')}
          </LocaleLink>{' '}
          {t('and')}{' '}
          <LocaleLink
            href={Routes.PrivacyPolicy}
            className="underline underline-offset-4 hover:text-primary"
          >
            {t('privacyPolicy')}
          </LocaleLink>
        </p>
      </main>
    </Suspense>
  )
}
