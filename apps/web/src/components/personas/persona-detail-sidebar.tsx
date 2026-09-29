'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { Badge } from '@workspace/ui/components/badge'
import { Calendar, Download, Eye, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

interface PersonaDetailSidebarProps {
  persona: {
    author: { name: string; username: string; avatar: string | null; verified: boolean }
    category: { name: string; slug: string } | null
    certified: boolean
    priceType: 'free' | 'paid'
    stats: { created: string; views: number; downloads: number }
  }
}

export function PersonaDetailSidebar({ persona }: PersonaDetailSidebarProps) {
  const t = useTranslations('PersonaPage.detail')

  return (
    <div className='mb-4 space-y-6'>
      <div className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <div className='mb-4 flex items-start'>
          <Avatar className='mr-4 h-12 w-12'>
            <AvatarImage src={persona.author.avatar ?? undefined} alt={persona.author.name} />
            <AvatarFallback className='text-sm'>{persona.author.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className='min-w-0'>
            <div className='flex items-center gap-1'>
              <LocaleLink
                href={`${Routes.Authors}/${persona.author.username}`}
                className='truncate font-medium text-foreground transition-colors hover:text-primary'
              >
                {persona.author.name}
              </LocaleLink>
              {persona.author.verified && (
                <Sparkles className='size-4 shrink-0 text-blue-500' fill='currentColor' aria-label={t('verified')} />
              )}
            </div>
            <p className='truncate text-muted-foreground text-sm'>@{persona.author.username}</p>
          </div>
        </div>

        <div className='flex flex-wrap gap-2'>
          <Badge variant='secondary'>{t(persona.priceType === 'free' ? 'priceFree' : 'pricePaid')}</Badge>
          {persona.certified && (
            <Badge variant='secondary' className='text-accent'>
              <Sparkles className='mr-1 size-3' />
              {t('certified')}
            </Badge>
          )}
          {persona.category && (
            <Badge variant='outline'>
              <LocaleLink href={`${Routes.Categories}/${persona.category.slug}`}>{persona.category.name}</LocaleLink>
            </Badge>
          )}
        </div>

        <div className='mt-4 flex flex-wrap gap-4 text-muted-foreground text-sm'>
          <span className='flex items-center'>
            <Calendar className='mr-1.5 size-4 text-primary' />
            {persona.stats.created}
          </span>
          <span className='flex items-center'>
            <Eye className='mr-1.5 size-4 text-primary' />
            {t('viewsCount', { count: persona.stats.views })}
          </span>
          <span className='flex items-center'>
            <Download className='mr-1.5 size-4 text-primary' />
            {t('downloadsCount', { count: persona.stats.downloads })}
          </span>
        </div>
      </div>
    </div>
  )
}
