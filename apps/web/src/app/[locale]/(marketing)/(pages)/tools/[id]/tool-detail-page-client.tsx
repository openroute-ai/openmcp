'use client'

import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { McpToolDetailContent } from '@/components/mcp-tools/mcp-tool-detail-content'
import { McpToolDetailHero } from '@/components/mcp-tools/mcp-tool-detail-hero'
import { trpc } from '@/lib/trpc/client'

export function ToolDetailPageClient() {
  const params = useParams()
  const locale = useLocale() as 'zh' | 'en'
  const id = params.id as string

  const { data, isLoading } = trpc.mcpTools.getMcpToolById.useQuery({ id }, { retry: false })

  if (isLoading) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-page px-5 py-10 sm:px-6 lg:px-10'>
          <div className='flex min-h-[400px] items-center justify-center'>
            <Loader2 className='h-8 w-8 animate-spin text-primary' />
          </div>
        </div>
      </div>
    )
  }

  if (!data?.success || !data.data) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-page px-5 py-10 sm:px-6 lg:px-10'>
          <div className='text-center'>
            <h1 className='mb-4 font-bold text-2xl'>工具未找到</h1>
            <p className='text-muted-foreground'>抱歉，找不到该工具信息。</p>
          </div>
        </div>
      </div>
    )
  }

  const tool = data.data
  const skillTitle =
    locale === 'zh' ? tool.skill.title || tool.skill.titleEn || '' : tool.skill.titleEn || tool.skill.title || ''
  const displayName = tool.name ?? tool.toolName
  const description = tool.description ?? ''

  const heroTool = {
    toolName: tool.toolName,
    name: displayName,
    skillSlug: tool.skill.slug,
    skillTitle,
  }

  return (
    <div className='mx-auto w-full max-w-page px-5 py-10 sm:px-6 lg:px-10'>
      <McpToolDetailHero tool={heroTool} />
      <div className='grid grid-cols-1 gap-8 lg:grid-cols-3'>
        <div className='lg:col-span-3'>
          <McpToolDetailContent
            description={description}
            inputSchema={tool.inputSchema}
            outputSchema={tool.outputSchema}
            isDeprecated={tool.isDeprecated}
          />
        </div>
      </div>
    </div>
  )
}
