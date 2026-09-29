'use client'

import { Download, Star } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { formatCount, type SkillRowData } from './skill-row'

interface AvatarColor {
  bg: string
  fg: string
}

/** Used when the hash lands outside the palette; keeps the return type definite. */
const AVATAR_FALLBACK: AvatarColor = { bg: 'rgba(120, 120, 120, 0.12)', fg: 'rgb(120, 120, 120)' }

const AVATAR_PALETTE: AvatarColor[] = [
  { bg: 'rgba(255, 149, 0, 0.1)', fg: 'rgb(255, 149, 0)' },
  { bg: 'rgba(50, 173, 230, 0.12)', fg: 'rgb(50, 173, 230)' },
  { bg: 'rgba(255, 45, 85, 0.1)', fg: 'rgb(255, 45, 85)' },
  { bg: 'rgba(52, 199, 89, 0.12)', fg: 'rgb(31, 158, 71)' },
  { bg: 'rgba(94, 75, 224, 0.12)', fg: 'rgb(94, 75, 224)' },
  { bg: 'rgba(255, 159, 10, 0.12)', fg: 'rgb(243, 147, 13)' },
]

export function avatarColor(title: string): AvatarColor {
  const key = title || '?'
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length] ?? AVATAR_FALLBACK
}

interface SkillCardProps {
  skill: SkillRowData
}

export function SkillCard({ skill }: SkillCardProps) {
  const t = useTranslations('Skills')
  const locale = useLocale() as 'zh' | 'en'
  const letter = (skill.title || '?').trim().charAt(0).toUpperCase()
  const color = avatarColor(skill.title)

  return (
    <LocaleLink
      href={`/skills/${skill.slug}`}
      prefetch={false}
      className='group flex h-full flex-col rounded-[12px] border border-border bg-card px-[20px] py-[24px] no-underline transition-all duration-200 hover:border-foreground/20 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]'
    >
      <div className='flex items-start gap-[12px]'>
        {skill.imageUrl ? (
          <img
            src={skill.imageUrl}
            alt={t('card.iconAlt', { title: skill.title })}
            loading='lazy'
            className='h-10 w-10 shrink-0 rounded-[8px] object-cover'
          />
        ) : (
          <div
            className='flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] font-bold text-[14px]'
            style={{ backgroundColor: color.bg, color: color.fg }}
          >
            {letter}
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-x-[6px] gap-y-[3px]'>
            <span className='truncate font-medium text-[15px] text-foreground leading-[1.4] tracking-tight'>
              {skill.title}
            </span>
          </div>
          <div className='mt-[6px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px]'>
            {/* P0: Security grade badge */}
            {skill.securityGrade === 'safe' && (
              <span className='inline-flex h-[20px] items-center whitespace-nowrap rounded-[12px] bg-green-50 px-[8px] text-[10px] text-green-700 border border-green-200 leading-none'>
                {t('card.safe')}
              </span>
            )}
            {skill.securityGrade === 'caution' && (
              <span className='inline-flex h-[20px] items-center whitespace-nowrap rounded-[12px] bg-yellow-50 px-[8px] text-[10px] text-yellow-700 border border-yellow-200 leading-none'>
                {t('card.caution')}
              </span>
            )}
            {skill.category ? (
              <span className='inline-flex h-[20px] items-center whitespace-nowrap rounded-[12px] border border-border px-[8px] text-[10px] text-muted-foreground leading-none'>
                {skill.category}
              </span>
            ) : null}
            {skill.certified ? (
              <span className='inline-flex h-[20px] items-center whitespace-nowrap rounded-[12px] border border-border px-[8px] text-[10px] text-muted-foreground leading-none'>
                {t('card.certified')}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <p className='mt-[8px] line-clamp-2 font-normal text-[13px] text-muted-foreground leading-[1.55]'>
        {skill.description || '—'}
      </p>
      <div className='mt-[20px] flex items-center gap-x-[12px] font-light text-[12px] text-muted-foreground leading-[1.4]'>
        <span className='flex items-center gap-1.5'>
          <Star className='h-3 w-3' aria-hidden />
          <span className='tabular-nums'>{formatCount(skill.views, locale)}</span>
        </span>
        <span className='flex items-center gap-1.5'>
          <Download className='h-3 w-3' aria-hidden />
          <span className='tabular-nums'>{formatCount(skill.downloads, locale)}</span>
        </span>
        {skill.author ? <span className='max-w-[140px] truncate whitespace-nowrap'>{skill.author}</span> : null}
      </div>
    </LocaleLink>
  )
}
