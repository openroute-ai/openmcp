import type { Metadata } from 'next'
import { assertLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { mcpToolsDataAccess } from '@/web/mcp-tools'
import { ToolDetailPageClient } from './tool-detail-page-client'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; locale: string }>
}): Promise<Metadata> {
  const { id } = await params
  const locale = assertLocale((await params).locale)
  const tool = await mcpToolsDataAccess.getMcpToolById(id, locale)

  if (!tool) {
    return constructMetadata({
      title: locale === 'zh' ? '工具未找到 - MCP 工具' : 'Tool Not Found - MCP Tools',
      description: locale === 'zh' ? '抱歉，找不到该工具信息。' : 'Sorry, this tool could not be found.',
      canonicalUrl: getUrlWithLocale(`/tools/${id}`, locale),
      locale,
    })
  }

  const name = tool.name || tool.toolName
  const title = locale === 'zh' ? `${name} - MCP 工具` : `${name} - MCP Tool`

  const description =
    (tool.description ?? '') ||
    (locale === 'zh' ? `查看 ${name} 的输入输出与用法` : `View input/output and usage for ${name}`)

  return constructMetadata({
    title,
    description: description.substring(0, 160),
    canonicalUrl: getUrlWithLocale(`/tools/${id}`, locale),
    keywords: ['MCP', '工具', tool.toolName],
    locale,
  })
}

export default function ToolDetailPage() {
  return <ToolDetailPageClient />
}
