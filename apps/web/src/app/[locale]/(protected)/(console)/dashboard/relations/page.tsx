import { redirect } from 'next/navigation'
import { getLocalePathname } from '@/i18n/navigation'

/** `relations` is now folded into the asset pages; keep the old path working. */
export default async function RelationsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(getLocalePathname({ href: '/dashboard/assets/mcp', locale }))
}
