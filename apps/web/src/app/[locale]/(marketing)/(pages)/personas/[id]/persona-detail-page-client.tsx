'use client'

import { Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { PersonaDetailContent } from '@/components/personas/persona-detail-content'
import { PersonaDetailHero } from '@/components/personas/persona-detail-hero'
import { PersonaDetailSidebar } from '@/components/personas/persona-detail-sidebar'
import { PersonaDetailSoul } from '@/components/personas/persona-detail-soul'
import { trpc } from '@/lib/trpc/client'

type SoulMeta = {
  soul?: {
    code?: string
    name?: string
    tagline?: string | null
    interpretation?: string | null
    prompt?: string | null
  } | null
}

export function PersonaDetailPageClient() {
  const t = useTranslations('PersonaPage.detail')
  const params = useParams()
  const lang = useLocale() === 'zh' ? 'zh' : 'en'
  const idOrSlug = params.id as string

  const { data: byId, isLoading: loadingById } = trpc.personas.getPersonaById.useQuery(
    { id: idOrSlug },
    { retry: false }
  )
  // Only pay for the slug lookup once the id lookup has come back empty.
  const shouldTrySlug = !loadingById && !byId?.success
  const { data: bySlug, isLoading: loadingBySlug } = trpc.personas.getPersonaBySlug.useQuery(
    { slug: idOrSlug },
    { enabled: shouldTrySlug, retry: false }
  )

  const isLoading = loadingById || (shouldTrySlug && loadingBySlug)
  const resolved = byId?.success ? byId : bySlug

  if (isLoading) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
          <div className='flex min-h-[400px] items-center justify-center'>
            <Loader2 className='size-8 animate-spin text-primary' />
          </div>
        </div>
      </div>
    )
  }

  if (!resolved?.success || !resolved.data) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
          <div className='text-center'>
            <h1 className='mb-4 font-bold text-2xl'>{t('notFoundHeading')}</h1>
            <p className='text-muted-foreground'>{t('notFoundHint')}</p>
          </div>
        </div>
      </div>
    )
  }

  const persona = resolved.data
  // The personas data access layer already resolves title/description for the
  // requested locale, so only the category still needs picking per language.
  const title = persona.title
  const description = persona.description ?? ''
  const soulMeta = (persona.metadata as SoulMeta | null | undefined)?.soul
  const hasSoul = Boolean(soulMeta?.code)

  return (
    <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
      <PersonaDetailHero
        persona={{
          id: persona.id,
          title: soulMeta?.code && soulMeta?.name ? `${soulMeta.code}・${soulMeta.name}` : title,
          imageUrl: persona.imageUrl,
          slug: persona.slug,
        }}
      />
      <div className='grid grid-cols-1 gap-8 lg:grid-cols-3'>
        <div className='lg:col-span-2'>
          {hasSoul ? (
            <PersonaDetailSoul
              soul={{
                code: soulMeta?.code as string,
                name: soulMeta?.name || title,
                tagline: soulMeta?.tagline || description || null,
                interpretation: soulMeta?.interpretation || null,
                prompt: soulMeta?.prompt || null,
              }}
            />
          ) : (
            <PersonaDetailContent description={description} />
          )}
        </div>
        <div className='lg:col-span-1'>
          <div className='lg:sticky lg:top-24'>
            <PersonaDetailSidebar
              persona={{
                author: persona.author,
                category: persona.category
                  ? {
                      name: lang === 'zh' ? persona.category.name : persona.category.nameEn || persona.category.name,
                      slug: persona.category.slug,
                    }
                  : null,
                certified: persona.certified,
                priceType: persona.priceType,
                stats: {
                  created: persona.createdAt.toISOString().split('T')[0] ?? '',
                  views: persona.views,
                  downloads: persona.downloads,
                },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
