import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { CustomPage } from '@/components/page/custom-page'
import { assertLocale, isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { getCompiledPage } from '@/lib/utils/get-compiled-page'

type PageProps = {
  params: Promise<{ locale: string }>
}

const PAGE_TYPE = 'cookie-policy'

export async function generateMetadata({ params }: PageProps): Promise<Metadata | undefined> {
  const { locale } = await params
  if (!isLocale(locale)) {
    return {}
  }

  const page = await getCompiledPage(PAGE_TYPE, locale)

  if (!page) {
    return {}
  }

  const t = await getTranslations({ locale, namespace: 'Metadata' })

  return constructMetadata({
    title: `${page.title} | ${t('title')}`,
    description: page.description,
    canonicalUrl: getUrlWithLocale('/cookie', locale),
  })
}

export default async function CookiePolicyPage({ params }: PageProps) {
  const locale = assertLocale((await params).locale)
  const page = await getCompiledPage(PAGE_TYPE, locale)

  if (!page) {
    notFound()
  }

  const Mdx = page.body

  return (
    <CustomPage
      title={page.title}
      description={page.description}
      date={page.date}
      content={<Mdx />}
    />
  )
}
