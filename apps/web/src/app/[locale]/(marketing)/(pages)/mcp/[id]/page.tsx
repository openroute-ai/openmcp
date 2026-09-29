import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { mcpServersDataAccess } from '@/web/mcp-servers'
import { McpDetailPageClient } from './mcp-detail-page-client'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; locale: string }>
}): Promise<Metadata | undefined> {
  const { id, locale: raw } = await params
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'McpPage.meta' })

  const server = await mcpServersDataAccess.getMcpServerById(id)

  if (!server) {
    return constructMetadata({
      title: t('notFoundTitle'),
      description: t('notFoundDescription'),
      canonicalUrl: getUrlWithLocale(`/mcp/${id}`, locale),
      locale,
    })
  }

  const description =
    (locale === 'zh' ? server.description : server.descriptionEn) ||
    t('detailFallbackDescription', { name: server.name })

  return constructMetadata({
    title: `${server.name} - ${t('detailTitleSuffix')}`,
    description: description.substring(0, 160),
    canonicalUrl: getUrlWithLocale(`/mcp/${server.slug || server.id}`, locale),
    image: server.logoUrl ?? undefined,
    keywords: ['MCP', 'MCP Server', 'Model Context Protocol', server.name],
    locale,
  })
}

export default function McpDetailPage() {
  return <McpDetailPageClient />
}
