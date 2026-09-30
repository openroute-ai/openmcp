'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { Badge } from '@workspace/ui/components/badge'
import { Calendar, Download, Eye, ExternalLink, Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { describeBillingModel, formatSkillPriceDisplay } from './skill-billing'

interface SkillDetailSidebarProps {
  skill: {
    author: { name: string; username: string; avatar: string | null; verified: boolean }
    category: { name: string; slug: string } | null
    certified: boolean
    priceType: 'free' | 'paid'
    priceAmount: string | null
    currency: string
    billingModel: 'one_time' | 'subscription' | 'pay_per_call' | null
    version: string | null
    sourceType: 'github' | 'zip' | null
    githubUrl: string | null
    stats: { created: string; updated: string; views: number; downloads: number }
  }
}

export function SkillDetailSidebar({ skill }: SkillDetailSidebarProps) {
  const t = useTranslations('SkillPage.detail')
  const locale = useLocale() as 'zh' | 'en'
  const priceLabel = formatSkillPriceDisplay(skill.priceType, skill.priceAmount, skill.currency, locale)
  const billingLabel = describeBillingModel(skill.billingModel, skill.priceType, locale)

  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <div className='mb-4 flex items-start'>
          <Avatar className='mr-4 h-12 w-12'>
            <AvatarImage src={skill.author.avatar ?? undefined} alt={skill.author.name} />
            <AvatarFallback className='text-sm'>{skill.author.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className='min-w-0'>
            <div className='flex items-center gap-1'>
              <LocaleLink
                href={`${Routes.Authors}/${skill.author.username}`}
                className='truncate font-medium text-foreground transition-colors hover:text-primary'
              >
                {skill.author.name}
              </LocaleLink>
              {skill.author.verified && (
                <Sparkles className='size-4 shrink-0 text-blue-500' fill='currentColor' aria-label={t('verified')} />
              )}
            </div>
            <p className='truncate text-muted-foreground text-sm'>@{skill.author.username}</p>
          </div>
        </div>

        <div className='flex flex-wrap gap-2'>
          <Badge variant='secondary'>{priceLabel}</Badge>
          {skill.certified && (
            <Badge variant='secondary' className='text-accent'>
              <Sparkles className='mr-1 size-3' />
              {t('certified')}
            </Badge>
          )}
          {skill.category && (
            <Badge variant='outline'>
              <LocaleLink href={`${Routes.Categories}/${skill.category.slug}`}>{skill.category.name}</LocaleLink>
            </Badge>
          )}
        </div>

        <dl className='mt-4 space-y-2.5 text-sm'>
          <div className='flex items-baseline justify-between gap-3'>
            <dt className='shrink-0 text-muted-foreground'>{t('billing')}</dt>
            <dd className='truncate text-foreground'>{billingLabel}</dd>
          </div>
          {skill.version ? (
            <div className='flex items-baseline justify-between gap-3'>
              <dt className='shrink-0 text-muted-foreground'>{t('version')}</dt>
              <dd className='truncate text-foreground'>v{skill.version}</dd>
            </div>
          ) : null}
          {skill.sourceType ? (
            <div className='flex items-baseline justify-between gap-3'>
              <dt className='shrink-0 text-muted-foreground'>{t('source')}</dt>
              <dd className='truncate text-foreground'>
                {skill.sourceType === 'github' ? t('sourceGithub') : t('sourceZip')}
              </dd>
            </div>
          ) : null}
        </dl>

        {skill.githubUrl ? (
          <a
            href={skill.githubUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='mt-4 inline-flex items-center gap-1.5 text-primary text-sm hover:underline'
          >
            <ExternalLink className='h-3.5 w-3.5' />
            {t('viewGithub')}
          </a>
        ) : null}

        <div className='mt-4 flex flex-wrap gap-4 text-muted-foreground text-sm'>
          <span className='flex items-center'>
            <Calendar className='mr-1.5 size-4 text-primary' />
            {skill.stats.updated || skill.stats.created}
          </span>
          <span className='flex items-center'>
            <Eye className='mr-1.5 size-4 text-primary' />
            {t('viewsCount', { count: skill.stats.views })}
          </span>
          <span className='flex items-center'>
            <Download className='mr-1.5 size-4 text-primary' />
            {t('downloadsCount', { count: skill.stats.downloads })}
          </span>
        </div>
      </div>
    </div>
  )
}
