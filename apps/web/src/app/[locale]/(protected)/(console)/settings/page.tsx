import { redirect } from 'next/navigation'
import { getLocalePathname } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

/** The settings hub is gone: account setup is the landing page for `/settings`. */
export default async function SettingsRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect(getLocalePathname({ href: Routes.SettingsSetup, locale }))
}
