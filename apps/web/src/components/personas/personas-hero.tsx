'use client'

import { Button } from '@workspace/ui/components/button'
import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'

interface PersonasHeroProps {
  totalPersonas?: number
}

export function PersonasHero({ totalPersonas = 0 }: PersonasHeroProps) {
  const t = useTranslations('Personas.hero')

  return (
    <div className='relative overflow-hidden'>
      <div aria-hidden='true' className='pointer-events-none absolute inset-0 select-none'>
        <div className='absolute -top-32 left-1/4 h-80 w-80 rounded-full bg-primary/10 blur-3xl' />
        <div className='absolute top-10 right-1/4 h-72 w-72 rounded-full bg-primary/5 blur-3xl' />
        <div className='absolute -bottom-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl' />
      </div>

      <div className='container relative mx-auto px-4 py-12'>
        <div className='flex flex-col items-center'>
          <div className='flex flex-col items-center gap-6 text-center'>
            <h1 className='font-bold text-foreground text-title tracking-tight'>{t('title')}</h1>
            <p className='max-w-2xl font-light text-base text-muted-foreground leading-[1.5em]'>
              {t('subtitle')}
            </p>
            <div className='flex flex-col gap-3 sm:flex-row'>
              <Button asChild size='lg' className='h-[50px] rounded-full px-8 font-medium text-[14px]'>
                <a href='#soul-gallery'>
                  <Sparkles className='mr-2 h-4 w-4' />
                  {t('testCta')}
                </a>
              </Button>
              <Button
                asChild
                size='lg'
                variant='secondary'
                className='h-[50px] rounded-full px-8 font-medium text-[14px]'
              >
                <LocaleLink href='/skills'>{t('installCta')}</LocaleLink>
              </Button>
            </div>
            <p className='text-muted-foreground text-sm'>
              <span className='font-semibold text-foreground'>{totalPersonas.toLocaleString()}</span> {t('countSuffix')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
