import { redirect } from 'next/navigation'
import { getLocalePathname } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

/** Monthly billing is now shown inside the usage page; keep the old path working. */
export default async function MonthlyBillingRedirect({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(getLocalePathname({ href: Routes.DashboardUsage, locale }))
}
