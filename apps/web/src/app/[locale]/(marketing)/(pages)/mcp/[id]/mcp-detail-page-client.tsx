'use client'

import { Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { McpDetailContent } from '@/components/mcp-servers/mcp-server-detail-content'
import { McpDetailHero } from '@/components/mcp-servers/mcp-server-detail-hero'
import { McpDetailSidebar } from '@/components/mcp-servers/mcp-server-detail-sidebar'
import { trpc } from '@/lib/trpc/client'

export function McpDetailPageClient() {
  const t = useTranslations('McpPage.detail')
  const params = useParams()
  const lang = useLocale() === 'zh' ? 'zh' : 'en'
  const id = params.id as string

  const { data, isLoading } = trpc.mcpServers.getMcpServerById.useQuery({ id }, { retry: false })

  if (isLoading) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-page px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
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
        <div className='mx-auto w-full max-w-page px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
          <div className='text-center'>
            <h1 className='mb-4 font-bold text-2xl'>{t('notFoundHeading')}</h1>
          </div>
        </div>
      </div>
    )
  }

  const server = data.data
  const description =
    (lang === 'zh' ? server.description || server.descriptionEn : server.descriptionEn || server.description) ?? ''

  const slug = server.slug || server.id

  return (
    <div className='mx-auto w-full max-w-page px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
      <McpDetailHero
        server={{
          name: server.name,
          slug,
          logoUrl: server.logoUrl,
          certified: server.certified,
          securityLevel: server.securityLevel,
          transport: server.transport,
        }}
      />
      <div className='grid grid-cols-1 gap-8 lg:grid-cols-3'>
        <div className='lg:col-span-2'>
          <McpDetailContent description={description} tools={server.tools as Record<string, unknown>[] | null} />
        </div>
        <div className='lg:col-span-1'>
          <div className='lg:sticky lg:top-24'>
            <McpDetailSidebar
              server={{
                id: server.id,
                slug,
                author: server.author,
                category: server.category?.id != null
                  ? {
                      name: lang === 'zh' ? server.category.name : server.category.nameEn || server.category.name,
                      slug: server.category.slug,
                    }
                  : null,
                transport: server.transport,
                authType: server.authType,
                hosting: server.hosting,
                scope: server.scope,
                endpoint: server.endpoint,
                priceType: server.priceType,
                priceAmount: server.priceAmount,
                billingModel: server.billingModel,
                unitPrice: server.unitPrice,
                currency: server.currency,
                access: server.access,
                stats: {
                  created: server.createdAt.toISOString().split('T')[0] ?? '',
                  updated: (server.updatedAt ?? server.createdAt).toISOString().split('T')[0] ?? '',
                  views: server.views,
                  downloads: server.downloads,
                },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
