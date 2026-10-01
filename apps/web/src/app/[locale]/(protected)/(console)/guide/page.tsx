import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { GuideToc } from '@/components/guide/guide-toc'
import { assertLocale, isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { getCompiledPage } from '@/lib/utils/get-compiled-page'

type PageProps = {
  params: Promise<{ locale: string }>
}

const PAGE_TYPE = 'user-guide'

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
    canonicalUrl: getUrlWithLocale('/guide', locale),
  })
}

/**
 * Publish-a-Skill walkthrough, rendered from `content/pages/user-guide.mdx`.
 *
 * The body is real MDX compiled per request, because the guide uses
 * `<Steps>`/`<Callout>`/`<Accordion>`, which `react-markdown` cannot render.
 */
export default async function UserGuidePage({ params }: PageProps) {
  const locale = assertLocale((await params).locale)
  const page = await getCompiledPage(PAGE_TYPE, locale)

  if (!page) {
    notFound()
  }

  const t = await getTranslations({ locale, namespace: 'DocsPage' })
  const Mdx = page.body

  return (
    <div className="mx-auto w-full max-w-page space-y-8 p-gutter lg:p-gutter-lg">
      <div className="space-y-4">
        <h1 className="text-center text-3xl font-bold tracking-tight">{page.title}</h1>
        <p className="text-center text-lg text-muted-foreground">{page.description}</p>
      </div>

      <div className="flex justify-center gap-10">
        <div className="mb-8 min-w-0 flex-1">
          <div className="prose prose-neutral dark:prose-invert prose-headings:mt-8 prose-headings:mb-4 prose-ol:mb-6 prose-p:mb-4 prose-ul:mb-6 max-w-none prose-img:rounded-lg">
            <Mdx />
          </div>
        </div>

        <GuideToc toc={page.toc} label={t('toc')} />
      </div>
    </div>
  )
}
