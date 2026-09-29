'use client'

import { Button } from '@workspace/ui/components/button'
import { Info, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { PersonaCard } from './persona-card'

type PersonaListItem = {
  id: string
  referenceId: string
  slug: string
  title: string
  titleEn: string | null
  description: string | null
  descriptionEn: string | null
  imageUrl: string | null
  priceType: 'free' | 'paid'
  certified: boolean
  views: number
  downloads: number
  publishedAt: Date | null
  createdAt: Date
  metadata: unknown
  author: { name: string }
  category: { name: string; nameEn: string } | null
}

interface PersonasGridProps {
  personas: PersonaListItem[]
  isLoading?: boolean
  error?: Error | null
  pagination?: { page: number; limit: number; total: number; totalPages: number }
  onPageChange?: (page: number) => void
}

export function PersonasGrid({ personas, isLoading, error, pagination, onPageChange }: PersonasGridProps) {
  const t = useTranslations('Personas')
  const locale = useLocale() as 'zh' | 'en'

  if (isLoading) {
    return (
      <div className='flex-1'>
        <div className='flex min-h-[400px] items-center justify-center'>
          <Loader2 className='h-8 w-8 animate-spin text-primary' />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex-1'>
        <div className='py-12 text-center'>
          <p className='text-destructive text-lg'>{t('grid.loadError')}</p>
        </div>
      </div>
    )
  }

  const priceLabel = (pt: 'free' | 'paid') =>
    pt === 'free' ? t('price.free') : t('price.paid')
  const cardPersonas = personas.map((p) => {
    const soul = (p.metadata as { soul?: { code?: string } } | null)?.soul
    const code = soul?.code ?? p.referenceId ?? p.slug ?? ''
    return {
      id: p.id,
      slug: p.slug,
      code,
      title: p.title || '',
      description: (locale === 'zh' ? p.description || p.descriptionEn : p.descriptionEn || p.description) || '',
      author: p.author?.name || '',
      imageUrl: p.imageUrl || '/assets/svg/placeholder-workflow.svg',
      category: p.category ? (locale === 'zh' ? p.category.name : p.category.nameEn || p.category.name) : null,
      price: priceLabel(p.priceType),
      certified: p.certified,
      views: p.views,
      downloads: p.downloads,
      date: (p.publishedAt ?? p.createdAt).toISOString().split('T')[0] ?? '',
    }
  })

  return (
    <div className='flex-1'>
      <div className='mb-8 flex w-full items-center gap-2 rounded-lg bg-muted/60 px-4 py-[13px]'>
        <Info className='h-[22px] w-[22px] shrink-0 text-muted-foreground' />
        <span className='text-[14px] text-muted-foreground'>
          {t('grid.helper')}
        </span>
      </div>

      {cardPersonas.length === 0 ? (
        <div className='flex-1'>
          <div className='py-12 text-center'>
            <p className='text-lg text-muted-foreground'>{t('grid.noMatch')}</p>
            <p className='mt-2 text-muted-foreground text-sm'>{t('grid.adjustFilters')}</p>
          </div>
        </div>
      ) : (
        <section
          id='soul-gallery'
          aria-label={t('grid.galleryAria')}
          className='grid grid-cols-[repeat(auto-fill,182px)] justify-center gap-x-9 gap-y-10 pt-6 md:justify-between'
        >
          {cardPersonas.map((persona) => (
            <PersonaCard key={persona.id} persona={persona} />
          ))}
        </section>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-12 flex flex-col items-center gap-4'>
          <div className='text-muted-foreground text-sm'>
            {t('grid.showingRange', {
              from: (pagination.page - 1) * pagination.limit + 1,
              to: Math.min(pagination.page * pagination.limit, pagination.total),
              total: pagination.total.toLocaleString(),
            })}
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              type='button'
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              {t('grid.previous')}
            </Button>
            <Button
              variant='outline'
              type='button'
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              {t('grid.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
