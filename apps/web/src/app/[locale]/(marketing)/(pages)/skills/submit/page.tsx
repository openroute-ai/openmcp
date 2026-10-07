import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { auth } from '@/lib/auth'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { SkillSubmitForm } from '@/components/skills/skill-submit-form'
import { ProviderNotLogin } from '@/components/provider/provider-not-login'
import { ProviderSubmitGate } from '@/components/provider/provider-submit-gate'
import { Routes } from '@/lib/routes'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'SkillSubmit.meta' })

  return constructMetadata({
    title: t('title'),
    description: t('description'),
    canonicalUrl: getUrlWithLocale(Routes.SkillSubmit, locale),
    keywords: ['Skill', 'skills', 'agent', 'publish', 'provider'],
    locale,
  })
}

export default async function SkillSubmitPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-7xl px-5 py-12 sm:px-6 lg:px-10'>
          <ProviderNotLogin />
        </div>
      </div>
    )
  }

  const t = await getTranslations('SkillSubmit')

  return (
    <ProviderSubmitGate title={t('cardTitle')} description={t('cardDescription')}>
      <SkillSubmitForm />
    </ProviderSubmitGate>
  )
}
