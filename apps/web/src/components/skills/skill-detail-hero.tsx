'use client'

import { Badge } from '@workspace/ui/components/badge'
import { ChevronRight, Download, Eye } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { avatarColor } from './skill-card'
import { formatSkillPriceDisplay } from './skill-billing'
import { formatCount } from './skill-row'

interface SkillDetailHeroProps {
  skill: {
    id: string
    title: string
    slug: string
    imageUrl: string | null
    description: string
    certified: boolean
    securityGrade: string | null
    priceType: 'free' | 'paid'
    priceAmount: string | null
    currency: string
    platforms: string[]
    views: number
    downloads: number
    version: string | null
  }
}

export function SkillDetailHero({ skill }: SkillDetailHeroProps) {
  const t = useTranslations('SkillPage.detail')
  const crumb = useTranslations('Common')
  const locale = useLocale() as 'zh' | 'en'
  const letter = (skill.title || '?').trim().charAt(0).toUpperCase()
  const color = avatarColor(skill.title)
  const priceLabel = formatSkillPriceDisplay(skill.priceType, skill.priceAmount, skill.currency, locale)

  return (
    <div className='mb-6'>
      <nav aria-label={crumb('breadcrumb')} className='mb-4 sm:mb-6'>
        <ol className='flex flex-wrap items-center gap-x-1 gap-y-2 text-xs sm:gap-x-2 sm:text-sm'>
          <li className='flex items-center'>
            <LocaleLink href='/' className='text-primary transition-colors hover:text-primary/80'>
              {crumb('home')}
            </LocaleLink>
          </li>
          <li className='flex items-center'>
            <ChevronRight className='mx-1 h-3 w-3 shrink-0 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4' />
            <LocaleLink href={Routes.Skills} className='text-primary transition-colors hover:text-primary/80'>
              {crumb('skills')}
            </LocaleLink>
          </li>
          <li className='hidden min-w-0 items-center sm:flex'>
            <ChevronRight className='mx-1 h-3 w-3 shrink-0 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4' />
            <span
              className='line-clamp-1 min-w-0 truncate text-muted-foreground'
              aria-current='page'
              title={skill.title}
            >
              {skill.title}
            </span>
          </li>
        </ol>
      </nav>

      <header className='mb-6 flex flex-col gap-5 sm:mb-8 sm:flex-row sm:items-start sm:gap-6'>
        {skill.imageUrl ? (
          <img
            src={skill.imageUrl}
            alt={skill.title}
            className='h-16 w-16 shrink-0 rounded-[12px] border border-border object-cover sm:h-20 sm:w-20'
          />
        ) : (
          <div
            className='flex h-16 w-16 shrink-0 items-center justify-center rounded-[12px] font-bold text-2xl sm:h-20 sm:w-20'
            style={{ backgroundColor: color.bg, color: color.fg }}
          >
            {letter}
          </div>
        )}

        <div className='min-w-0 flex-1'>
          <h1 className='mb-2 text-balance font-bold text-xl text-foreground sm:text-2xl md:text-3xl'>
            {skill.title}
          </h1>
          <p className='mb-3 font-mono text-muted-foreground text-sm'>{skill.slug}</p>
          {skill.description ? (
            <p className='mb-4 max-w-3xl text-muted-foreground text-sm leading-relaxed sm:text-base'>
              {skill.description}
            </p>
          ) : null}

          <div className='mb-4 flex flex-wrap items-center gap-2'>
            {skill.securityGrade === 'safe' && (
              <Badge variant='secondary' className='border-green-200 bg-green-50 text-green-700'>
                {t('safe')}
              </Badge>
            )}
            {skill.securityGrade === 'caution' && (
              <Badge variant='secondary' className='border-yellow-200 bg-yellow-50 text-yellow-700'>
                {t('caution')}
              </Badge>
            )}
            {skill.certified && (
              <Badge variant='secondary' className='text-accent'>
                {t('certified')}
              </Badge>
            )}
            <Badge variant='outline'>{priceLabel}</Badge>
            {skill.version ? <Badge variant='outline'>v{skill.version}</Badge> : null}
            {skill.platforms.slice(0, 6).map((platform) => (
              <Badge key={platform} variant='outline'>
                {platform}
              </Badge>
            ))}
          </div>

          <div className='flex flex-wrap items-center gap-4 text-muted-foreground text-sm'>
            <span className='inline-flex items-center gap-1.5'>
              <Eye className='h-4 w-4' aria-hidden />
              {formatCount(skill.views, locale)}
            </span>
            <span className='inline-flex items-center gap-1.5'>
              <Download className='h-4 w-4' aria-hidden />
              {formatCount(skill.downloads, locale)}
            </span>
          </div>
        </div>
      </header>
    </div>
  )
}
