'use client'

import { Button } from '@workspace/ui/components/button'
import { LayoutGrid, List, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { cn } from '@/lib/utils/index'
import { SkillCard } from './skill-card'
import { SkillRow, type SkillRowData } from './skill-row'

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

interface SkillsListProps {
  skills: SkillListItem[]
  isLoading?: boolean
  error?: Error | null
  pagination?: { page: number; limit: number; total: number; totalPages: number }
  onPageChange?: (page: number) => void
}

export function SkillsList({ skills, isLoading, error, pagination, onPageChange }: SkillsListProps) {
  const t = useTranslations('Skills')
  const locale = useLocale() as 'zh' | 'en'
  const [view, setView] = useState<'list' | 'grid'>('list')

  if (isLoading) {
    return (
      <div className='flex min-h-[300px] items-center justify-center'>
        <Loader2 className='h-8 w-8 animate-spin text-primary' />
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex min-h-[300px] items-center justify-center'>
        <p className='text-destructive'>
          {t('list.loadError')}
        </p>
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className='flex min-h-[300px] flex-col items-center justify-center gap-2'>
        <p className='text-lg text-muted-foreground'>
          {t('list.noMatch')}
        </p>
        <p className='text-muted-foreground text-sm'>
          {t('list.adjustFilters')}
        </p>
      </div>
    )
  }

  const priceLabel = (pt: 'free' | 'paid') =>
    pt === 'free' ? t('price.free') : t('price.paid')

  const rows: SkillRowData[] = skills.map((s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title || '',
    description: (locale === 'zh' ? s.description || s.descriptionEn : s.descriptionEn || s.description) || '',
    author: s.author?.name || '',
    imageUrl: s.imageUrl || undefined,
    category: s.category ? (locale === 'zh' ? s.category.name : s.category.nameEn || s.category.name) : null,
    price: priceLabel(s.priceType),
    views: s.views,
    downloads: s.downloads,
    certified: s.certified,
  }))

  return (
    <div className='flex flex-1 flex-col'>
      <div className='mb-4 flex items-center justify-between gap-3'>
        <p className='text-muted-foreground text-sm'>
          {t('list.totalPrefix')} {(pagination?.total ?? rows.length).toLocaleString(locale)}{' '}
          {t('list.totalSuffix')}
        </p>
        <div className='flex items-center gap-1 rounded-[8px] border border-border bg-card p-0.5'>
          <button
            type='button'
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            aria-label={t('list.listView')}
            className={cn(
              'flex h-[30px] w-[30px] items-center justify-center rounded-[6px] transition-colors duration-150',
              view === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <List className='h-4 w-4' aria-hidden />
          </button>
          <button
            type='button'
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
            aria-label={t('list.gridView')}
            className={cn(
              'flex h-[30px] w-[30px] items-center justify-center rounded-[6px] transition-colors duration-150',
              view === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <LayoutGrid className='h-4 w-4' aria-hidden />
          </button>
        </div>
      </div>
      {view === 'list' ? (
        <div className='overflow-hidden rounded-[12px] border border-border bg-card shadow-sm'>
          {rows.map((skill, i) => (
            <div key={skill.id}>
              {i > 0 ? <div className='mx-5 h-px bg-border' /> : null}
              <SkillRow skill={skill} />
            </div>
          ))}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-[16px] sm:grid-cols-2 xl:grid-cols-3'>
          {rows.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      )}
      {pagination && pagination.totalPages > 1 && (
        <div className='mt-8 flex flex-col items-center gap-4'>
          <div className='text-muted-foreground text-sm'>
            {t('list.showingRange')} {(pagination.page - 1) * pagination.limit + 1}-
            {Math.min(pagination.page * pagination.limit, pagination.total)}，
            {t('list.ofTotal', { total: pagination.total.toLocaleString() })}
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              type='button'
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              {t('list.previous')}
            </Button>
            <Button
              variant='outline'
              type='button'
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              {t('list.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
