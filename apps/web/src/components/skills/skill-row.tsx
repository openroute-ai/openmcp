'use client'

import { Download, Sparkles, Star } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { avatarColor } from './skill-card'

export type SkillRowData = {
  id: string
  slug: string
  title: string
  description: string
  author: string
  imageUrl?: string
  category: string | null
  price: string
  views: number
  downloads: number
  certified: boolean
  securityGrade?: string | null // P0: Security grade (safe, caution, unsafe, etc.)
}

interface SkillRowProps {
  skill: SkillRowData
}

export function formatCount(n: number, locale: 'zh' | 'en'): string {
  if (n >= 100000000) return locale === 'zh' ? `${(n / 100000000).toFixed(1)} 亿` : `${(n / 100000000).toFixed(1)}B`
  if (n >= 10000) return locale === 'zh' ? `${(n / 10000).toFixed(1)} 万` : `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString(locale)
}

export function SkillRow({ skill }: SkillRowProps) {
  const t = useTranslations('Skills')
  const locale = useLocale() as 'zh' | 'en'

  const detailHref = `/skills/${skill.slug}`

  return (
    <LocaleLink
      href={detailHref}
      prefetch={false}
      className='group grid w-full cursor-pointer grid-cols-[44px_minmax(0,1fr)] items-start gap-x-3 px-5 py-5 text-left no-underline transition-colors duration-200 hover:bg-muted/50 md:grid-cols-[44px_minmax(0,1fr)_auto]'
    >
            {skill.imageUrl ? (
        <img
          src={skill.imageUrl}
          alt={t('row.iconAlt', { title: skill.title })}
          loading='lazy'
          className='h-11 w-11 shrink-0 self-center rounded-[8px] border border-border object-cover ring-2 ring-offset-1 ring-offset-background'
          style={{ ['--tw-ring-color' as string]: avatarColor(skill.title).fg }}
        />
      ) : (
        <div
          className='flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-[8px] font-bold text-[14px]'
          style={{ backgroundColor: avatarColor(skill.title).bg, color: avatarColor(skill.title).fg }}
        >
          {(skill.title || '?').trim().charAt(0).toUpperCase()}
        </div>
      )}
      <div className='min-w-0'>
        <div className='mb-1 flex flex-wrap items-center gap-x-2 gap-y-1'>
          <span className='truncate font-medium text-[16px] text-foreground tracking-tight'>{skill.title}</span>
          {skill.certified ? (
            <span className='inline-flex h-[20px] items-center gap-0.5 rounded-full border border-primary/20 bg-primary/10 px-2 font-medium text-[10px] text-primary leading-none'>
              <Sparkles className='h-3 w-3' aria-hidden />
              {t('row.certified')}
            </span>
          ) : null}
          {skill.category ? (
            <span className='inline-flex h-[20px] items-center whitespace-nowrap rounded-full border border-border px-2 text-[10px] text-muted-foreground leading-none'>
              {skill.category}
            </span>
          ) : null}
          <span className='inline-flex h-[20px] items-center rounded-full bg-primary/10 px-2 font-medium text-[10px] text-primary leading-none'>
            {skill.price}
          </span>
        </div>
        <p className='line-clamp-1 min-h-[18px] text-[12.5px] text-muted-foreground leading-[1.5]'>
          {skill.description || '—'}
        </p>
      </div>
      <div className='hidden shrink-0 items-center justify-end gap-x-4 pt-1 font-light text-[12px] text-muted-foreground md:flex'>
        <span className='flex items-center gap-1 whitespace-nowrap'>
          <Star className='h-3.5 w-3.5' aria-hidden />
          <span className='tabular-nums'>{formatCount(skill.views, locale)}</span>
        </span>
        <span className='flex items-center gap-1 whitespace-nowrap'>
          <Download className='h-3.5 w-3.5' aria-hidden />
          <span className='tabular-nums'>{formatCount(skill.downloads, locale)}</span>
        </span>
        <span className='max-w-[120px] truncate'>{skill.author || '—'}</span>
      </div>
    </LocaleLink>
  )
}
