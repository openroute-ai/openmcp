'use client'

import { Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@workspace/ui/components/button'
import { SkillCard } from './skill-card'

type SkillListItem = {
  id: string
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
  author: { name: string }
  category: { name: string; nameEn: string } | null
}

interface SkillsGridProps {
  skills: SkillListItem[]
  isLoading?: boolean
  error?: Error | null
  pagination?: { page: number; limit: number; total: number; totalPages: number }
  onPageChange?: (page: number) => void
}

export function SkillsGrid({ skills, isLoading, error, pagination, onPageChange }: SkillsGridProps) {
  const t = useTranslations('Skills')
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

  if (skills.length === 0) {
    return (
      <div className='flex-1'>
        <div className='py-12 text-center'>
          <p className='text-lg text-muted-foreground'>{t('grid.noMatch')}</p>
          <p className='mt-2 text-muted-foreground text-sm'>{t('grid.adjustFilters')}</p>
        </div>
      </div>
    )
  }

  const priceLabel = (pt: 'free' | 'paid') => (pt === 'free' ? t('price.free') : t('price.paid'))
  const cardSkills = skills.map((s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title || '',
    description: (locale === 'zh' ? s.description || s.descriptionEn : s.descriptionEn || s.description) || '',
    author: s.author?.name || '',
    imageUrl: s.imageUrl || '/assets/svg/placeholder-workflow.svg',
    category: s.category ? (locale === 'zh' ? s.category.name : s.category.nameEn || s.category.name) : null,
    price: priceLabel(s.priceType),
    views: s.views,
    downloads: s.downloads,
    date: (s.publishedAt ?? s.createdAt).toISOString().split('T')[0] ?? '',
    certified: s.certified,
  }))

  return (
    <div className='flex-1'>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3'>
        {cardSkills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} />
        ))}
      </div>
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
