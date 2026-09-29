import type { Metadata } from 'next'
import type { Locale } from 'next-intl'
import { defaultMessages } from '@/i18n/messages'
import { routing } from '@/i18n/routing'
import { getBaseUrl, getUrlWithLocale } from './urls/urls'

/** Default Open Graph image, served by the `/og` route. */
const DEFAULT_OG_IMAGE = '/og'

/**
 * Get Open Graph locale from Next.js locale
 */
function getOpenGraphLocale(locale: Locale): string {
  const localeMap: Record<Locale, string> = {
    en: 'en_US',
    zh: 'zh_CN',
  }
  return localeMap[locale] || 'en_US'
}

/**
 * Get alternate language URLs for hreflang tags
 */
function getAlternateLanguages(canonicalUrl: string, currentLocale: Locale): Record<string, string> {
  const alternates: Record<string, string> = {}
  const basePath = canonicalUrl.replace(getBaseUrl(), '')

  for (const locale of routing.locales) {
    if (locale !== currentLocale) {
      const localeUrl = getUrlWithLocale(basePath, locale)
      alternates[locale] = localeUrl
    }
  }

  return alternates
}

/**
 * Get default keywords based on locale
 */
function getDefaultKeywords(locale: Locale): string[] {
  if (locale === 'zh') {
    return [
      'n8n工作流',
      'n8n工作流模板',
      'n8n自动化',
      '工作流分享',
      'n8n社区',
      '工作流下载',
      '工作流上传',
      'n8n工作流库',
      '自动化工作流',
      '工作流解决方案',
      'n8n模板',
      '工作流测试',
      'n8n集成',
      '工作流管理',
      'n8n最佳实践',
    ]
  }
  return [
    'n8n workflow',
    'n8n workflow template',
    'n8n automation',
    'workflow sharing',
    'n8n community',
    'workflow download',
    'workflow upload',
    'n8n workflow library',
    'automation workflow',
    'workflow solution',
    'n8n template',
    'workflow testing',
    'n8n integration',
    'workflow management',
    'n8n best practices',
  ]
}

/**
 * Construct the metadata object for the current page with enhanced SEO support
 */
export function constructMetadata({
  title,
  description,
  canonicalUrl,
  image,
  noIndex = false,
  keywords,
  locale = 'zh',
  alternateLanguages,
}: {
  title?: string
  description?: string
  canonicalUrl?: string
  image?: string
  noIndex?: boolean
  keywords?: string | string[]
  locale?: Locale
  alternateLanguages?: Record<string, string>
} = {}): Metadata {
  title = title || defaultMessages.Metadata.title
  description = description || defaultMessages.Metadata.description
  image = image || DEFAULT_OG_IMAGE

  // Handle image URL - check if it's already an absolute URL
  let ogImageUrl: URL
  if (image) {
    try {
      // Try to parse as absolute URL first
      ogImageUrl = new URL(image)
    } catch {
      // If it fails, it's a relative path, so combine with base URL
      const imagePath = image.startsWith('/') ? image : `/${image}`
      ogImageUrl = new URL(`${getBaseUrl()}${imagePath}`)
    }
  } else {
    // Fallback to default image
    ogImageUrl = new URL(`${getBaseUrl()}${DEFAULT_OG_IMAGE}`)
  }
  
  const ogLocale = getOpenGraphLocale(locale)

  // Build keywords string
  const keywordsArray = Array.isArray(keywords) ? keywords : keywords ? [keywords] : []
  const defaultKeywords = getDefaultKeywords(locale)
  const allKeywords = [...defaultKeywords, ...keywordsArray].join(', ')

  // Get alternate language URLs
  const alternates = alternateLanguages || (canonicalUrl ? getAlternateLanguages(canonicalUrl, locale) : {})

  return {
    title,
    description,
    keywords: allKeywords,
    alternates: {
      canonical: canonicalUrl,
      languages: {
        'x-default': canonicalUrl || getBaseUrl(),
        ...alternates,
      },
    },
    openGraph: {
      type: 'website',
      locale: ogLocale,
      url: canonicalUrl,
      title,
      description,
      siteName: defaultMessages.Metadata.name,
      images: [
        {
          url: ogImageUrl.toString(),
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl.toString()],
      site: getBaseUrl(),
    },
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
        { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
      ],
      shortcut: '/favicon-32x32.png',
      apple: '/apple-touch-icon.png',
    },
    metadataBase: new URL(getBaseUrl()),
    manifest: `${getBaseUrl()}/manifest.webmanifest`,
    ...(noIndex && {
      robots: {
        index: false,
        follow: false,
      },
    }),
  }
}
