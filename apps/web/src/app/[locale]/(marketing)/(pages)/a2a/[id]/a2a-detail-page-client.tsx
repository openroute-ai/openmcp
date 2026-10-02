'use client'

import { Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { A2aDetailContent } from '@/components/a2a-agents/a2a-agent-detail-content'
import { A2aDetailHero } from '@/components/a2a-agents/a2a-agent-detail-hero'
import { A2aDetailSidebar } from '@/components/a2a-agents/a2a-agent-detail-sidebar'
import { type AssetAuthType, type A2aProtocolVersion } from '@/lib/registry-labels'
import { trpc } from '@/lib/trpc/client'

export function A2aDetailPageClient() {
  const t = useTranslations('A2APage.detail')
  const params = useParams()
  const lang = useLocale() === 'zh' ? 'zh' : 'en'
  const id = params.id as string

  const { data, isLoading } = trpc.a2aAgents.getAgentById.useQuery({ id }, { retry: false })

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

  const agent = data.data
  const description =
    (lang === 'zh' ? agent.description || agent.descriptionEn : agent.descriptionEn || agent.description) ?? ''

  const slug = agent.slug || agent.id

  return (
    <div className='mx-auto w-full max-w-page px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
      <A2aDetailHero
        agent={{
          name: agent.name,
          slug,
          logoUrl: agent.logoUrl,
          certified: agent.certified,
          securityLevel: agent.securityLevel,
          authType: agent.authType as AssetAuthType | null,
          protocolVersion: agent.protocolVersion as A2aProtocolVersion | null,
        }}
      />
      <div className='grid grid-cols-1 gap-8 lg:grid-cols-3'>
        <div className='lg:col-span-2'>
          <A2aDetailContent
            description={description}
            agentCard={agent.agentCard as Record<string, unknown> | null}
          />
        </div>
        <div className='lg:col-span-1'>
          <div className='lg:sticky lg:top-24'>
            <A2aDetailSidebar
              agent={{
                id: agent.id,
                slug,
                author: agent.author,
                category: agent.category?.id != null
                  ? {
                      name: lang === 'zh' ? agent.category.name : agent.category.nameEn || agent.category.name,
                      slug: agent.category.slug,
                    }
                  : null,
                authType: agent.authType as AssetAuthType | null,
                protocolVersion: agent.protocolVersion,
                scope: agent.visibility ?? 'public',
                priceType: agent.priceType,
                priceAmount: agent.priceAmount,
                billingModel: agent.billingModel,
                unitPrice: agent.unitPrice,
                currency: agent.currency,
                agentCardUrl: agent.agentCardUrl,
                access: agent.access,
                stats: {
                  created: agent.createdAt.toISOString().split('T')[0] ?? '',
                  updated: (agent.updatedAt ?? agent.createdAt).toISOString().split('T')[0] ?? '',
                  views: agent.views,
                  downloads: agent.downloads,
                },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
