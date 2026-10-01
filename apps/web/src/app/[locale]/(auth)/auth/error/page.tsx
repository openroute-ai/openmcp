import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { LocaleLink } from '@/i18n/navigation'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { Routes } from '@/lib/routes'
import { getUrlWithLocale } from '@/lib/urls/urls'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale } = await params
  if (!isLocale(locale)) return undefined

  const t = await getTranslations({ locale, namespace: 'Metadata' })
  const pt = await getTranslations({ locale, namespace: 'AuthPage.error' })

  return constructMetadata({
    title: `${pt('title')} | ${t('title')}`,
    description: t('description'),
    canonicalUrl: getUrlWithLocale(Routes.AuthError, locale),
  })
}

/**
 * Landing page for Better Auth's `errorURL`.
 *
 * Reached when a social sign-in is denied, an OAuth code is replayed or an
 * account-linking attempt collides — the provider redirects here instead of
 * showing the raw error. The underlying message is deliberately not rendered:
 * it lands in the URL, so echoing it back would reflect provider-supplied text
 * into the page and leak state into the address bar.
 */
export default async function AuthErrorPage() {
  const t = await getTranslations('AuthPage.error')

  return (
    <AuthCard headerLabel={t('title')} description={t('tryAgain')} className="w-full shadow-sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('checkEmail')}</p>
        <LocaleLink
          href={Routes.Login}
          className="text-center text-sm text-primary underline underline-offset-4 hover:text-primary/80"
        >
          {t('backToLogin')}
        </LocaleLink>
      </div>
    </AuthCard>
  )
}
