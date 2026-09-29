import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import { isLocale } from '@/i18n/routing'
import { requireUnauth } from '@/lib/server/auth-utils'
import { Routes } from '@/lib/routes'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale } = await params
  if (!isLocale(locale)) return undefined

  const t = await getTranslations({ locale, namespace: 'AuthPage.forgotPassword' })
  return { title: t('title') }
}

export default async function ForgotPasswordPage() {
  // Reachable only while signed out; a valid session belongs on the dashboard.
  await requireUnauth(Routes.Dashboard)

  return (
    <main className="flex w-full max-w-md flex-col gap-6 px-4 py-6 sm:px-6">
      <ForgotPasswordForm className="w-full shadow-sm" />
    </main>
  )
}
