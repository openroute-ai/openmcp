'use client'

import { BadgeCheck, ChevronRight, KeyRound, ShieldCheck } from 'lucide-react'
import Image from 'next/image'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { type AssetAuthType, authLabel, securityLabel } from '@/lib/registry-labels'
import { Routes } from '@/lib/routes'

interface A2aDetailHeroProps {
  agent: {
    name: string
    slug: string
    logoUrl: string | null
    certified: boolean
    securityLevel: string | null
    authType: AssetAuthType | null
    protocolVersion: string | null
  }
}

export function A2aDetailHero({ agent }: A2aDetailHeroProps) {
  const t = useTranslations('A2APage.detail')
  const card = useTranslations('A2APage.card')
  const crumb = useTranslations('Common')
  const lang = useLocale() === 'zh' ? 'zh' : 'en'

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
            <LocaleLink href={Routes.A2A} className='text-primary transition-colors hover:text-primary/80'>
              {crumb('a2aMarket')}
            </LocaleLink>
          </li>
          <li className='hidden min-w-0 items-center sm:flex'>
            <ChevronRight className='mx-1 h-3 w-3 shrink-0 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4' />
            <span
              className='line-clamp-1 min-w-0 truncate text-muted-foreground'
              aria-current='page'
              title={agent.name}
            >
              {agent.name}
            </span>
          </li>
        </ol>
      </nav>

      <header className='mt-7 flex flex-col gap-6 md:flex-row md:items-start md:justify-between'>
        <div className='flex min-w-0 items-center gap-4'>
          <div className='relative size-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted'>
            {agent.logoUrl ? (
              <Image src={agent.logoUrl} alt='' fill className='object-cover' sizes='48px' unoptimized />
            ) : (
              <div className='flex size-full items-center justify-center bg-primary/10 font-bold text-lg text-primary'>
                {agent.name.charAt(0).toUpperCase() || 'A'}
              </div>
            )}
          </div>
          <div className='flex min-w-0 flex-col gap-1'>
            <h1 className='truncate font-medium text-foreground text-xl tracking-tight md:text-2xl'>{agent.name}</h1>
            <div className='truncate font-mono text-foreground/55 text-sm' title={`@${agent.slug}`}>
              @{agent.slug}
            </div>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-x-6 gap-y-2 md:pt-1'>
          {agent.certified && (
            <div className='flex shrink-0 items-center gap-1.5'>
              <BadgeCheck className='size-3.5 text-primary' aria-hidden />
              <span className='font-medium text-foreground/90 text-xs'>{t('certified')}</span>
            </div>
          )}
          <div className='flex shrink-0 items-center gap-1.5'>
            <ShieldCheck className='size-3.5 text-foreground/35' aria-hidden />
            <span className='font-medium text-foreground/90 text-xs'>
              {securityLabel(agent.securityLevel, lang) || t('safeDefault')}
            </span>
          </div>
          {agent.protocolVersion && (
            <div className='flex shrink-0 items-center gap-1.5'>
              <span className='font-medium text-foreground/90 text-xs'>
                {card('protocol', { version: agent.protocolVersion })}
              </span>
            </div>
          )}
          <div className='flex shrink-0 items-center gap-1.5'>
            <KeyRound className='size-3.5 text-foreground/35' aria-hidden />
            <span className='font-medium text-foreground/90 text-xs'>
              {authLabel(agent.authType, lang) || '—'}
            </span>
          </div>
        </div>
      </header>
    </div>
  )
}
