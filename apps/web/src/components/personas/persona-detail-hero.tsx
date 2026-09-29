'use client'

import { ChevronRight } from 'lucide-react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

interface PersonaDetailHeroProps {
  persona: { id: string; title: string; imageUrl: string | null; slug: string }
}

export function PersonaDetailHero({ persona }: PersonaDetailHeroProps) {
  const t = useTranslations('PersonaPage.detail')
  const crumb = useTranslations('Common')

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
            <LocaleLink
              href={Routes.Personas}
              className='text-primary transition-colors hover:text-primary/80'
            >
              {crumb('personas')}
            </LocaleLink>
          </li>
          <li className='hidden min-w-0 items-center sm:flex'>
            <ChevronRight className='mx-1 h-3 w-3 shrink-0 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4' />
            <span
              className='line-clamp-1 min-w-0 truncate text-muted-foreground'
              aria-current='page'
              title={persona.title}
            >
              {persona.title}
            </span>
          </li>
        </ol>
      </nav>

      <header className='mb-6 sm:mb-10'>
        <h1 className='mb-6 text-balance text-center font-bold text-xl text-foreground sm:mb-8 sm:text-2xl md:text-3xl'>
          {persona.title}
        </h1>
        <div className='mb-6 h-[300px] min-h-[300px] rounded-lg border border-border bg-card shadow-sm sm:mb-8 sm:h-[480px] md:h-[560px] md:min-h-[480px]'>
          <div className='relative flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-muted/30'>
            {persona.imageUrl ? (
              <Image
                src={persona.imageUrl}
                alt={persona.title}
                fill
                className='object-cover'
                sizes='(max-width: 1024px) 100vw, 66vw'
              />
            ) : (
              <div className='flex size-full items-center justify-center px-6 text-center text-muted-foreground text-sm'>
                {t('noImage')}
              </div>
            )}
          </div>
        </div>
      </header>
    </div>
  )
}
