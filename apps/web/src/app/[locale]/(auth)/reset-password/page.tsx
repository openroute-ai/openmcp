import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { isLocale } from '@/i18n/routing'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale } = await params
  if (!isLocale(locale)) return undefined

  const t = await getTranslations({ locale, namespace: 'AuthPage.resetPassword' })
  return { title: t('title') }
}

export default async function ResetPasswordPage() {
  const t = await getTranslations('AuthPage.resetPassword')

  return (
    <main className="flex w-full max-w-md flex-col gap-6 px-4 py-6 sm:px-6">
      {/* The form reads the reset `token` with useSearchParams, which opts the
          route out of static rendering unless wrapped in Suspense. */}
      <Suspense fallback={null}>
        <ResetPasswordForm className="w-full shadow-sm" />
      </Suspense>

      <p className="text-center text-sm text-muted-foreground">
        <LocaleLink href={Routes.Login} className="text-primary underline underline-offset-4 hover:text-primary/80">
          {t('backToLogin')}
        </LocaleLink>
      </p>
    </main>
  )
}
