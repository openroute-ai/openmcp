'use client'

import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, ArrowRight, BadgeCheck, Bot, Plug, Puzzle } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

interface ShelfDef {
  icon: LucideIcon
  protocol: string
  key: 'skill' | 'mcp' | 'a2a'
  href: string
  itemKeys: readonly string[]
}

const shelves: ShelfDef[] = [
  {
    icon: Puzzle,
    protocol: 'SKILL.md',
    key: 'skill',
    href: Routes.Skills,
    itemKeys: ['bid', 'finance', 'compliance'],
  },
  {
    icon: Plug,
    protocol: 'MCP',
    key: 'mcp',
    href: Routes.MCP,
    itemKeys: ['invoice', 'quotes', 'erp'],
  },
  {
    icon: Bot,
    protocol: 'A2A',
    key: 'a2a',
    href: Routes.A2A,
    itemKeys: ['legal', 'support', 'analytics'],
  },
]

export function CapabilityCarousel() {
  const t = useTranslations('HomePage.carousel')
  const [index, setIndex] = useState(0)
  const count = shelves.length

  const prev = () => setIndex((i) => (i - 1 + count) % count)
  const next = () => setIndex((i) => (i + 1) % count)

  return (
    <section className='py-10 md:py-16' aria-label={t('ariaLabel')}>
      <div className='mx-auto w-full max-w-page px-gutter sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='mx-auto mb-10 max-w-3xl text-center'>
          <span className='mb-4 inline-block rounded-full border border-border bg-muted/40 px-3 py-1 font-medium text-muted-foreground text-xs'>
            {t('eyebrow')}
          </span>
          <h2 className='mb-4 text-balance font-medium text-foreground text-title tracking-tight'>
            {t('title')}
          </h2>
          <p className='text-pretty text-muted-foreground leading-relaxed'>{t('subtitle')}</p>
        </div>

        <div className='overflow-hidden rounded-[20px] bg-muted'>
          <div
            className='flex transition-transform duration-500 ease-out'
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {shelves.map(({ icon: Icon, protocol, key, href, itemKeys }) => (
              <div key={key} className='w-full shrink-0'>
                <div className='grid min-h-90 items-center gap-10 p-8 md:grid-cols-2 md:p-12'>
                  <div>
                    <div className='mb-5 flex items-center gap-3'>
                      <div className='w-fit rounded-lg bg-foreground p-3 text-background'>
                        <Icon className='h-5 w-5' />
                      </div>
                      <span className='rounded-full border border-border bg-background px-3 py-1 font-medium text-muted-foreground text-xs'>
                        {protocol}
                      </span>
                    </div>
                    <h3 className='mb-4 text-pretty font-medium text-foreground text-subtitle tracking-tight'>
                      {t(`shelves.${key}.title`)}
                    </h3>
                    <p className='mb-6 text-pretty text-muted-foreground leading-relaxed'>
                      {t(`shelves.${key}.description`)}
                    </p>
                    <LocaleLink
                      href={href}
                      className='inline-flex items-center gap-1 font-medium text-primary underline-offset-4 transition hover:underline'
                    >
                      {t(`shelves.${key}.cta`)}
                      <ArrowRight className='h-4 w-4' />
                    </LocaleLink>
                  </div>

                  <div className='rounded-2xl border border-border bg-background p-6'>
                    <div className='mb-4 flex items-center justify-between'>
                      <span className='font-medium text-muted-foreground text-xs'>{t('sampleLabel')}</span>
                      <BadgeCheck className='h-4 w-4 text-primary' />
                    </div>
                    <ul className='space-y-3'>
                      {itemKeys.map((itemKey) => (
                        <li
                          key={itemKey}
                          className='flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3'
                        >
                          <span className='font-medium text-foreground'>
                            {t(`shelves.items.${itemKey}.name`)}
                          </span>
                          <span className='rounded-full bg-primary/10 px-2.5 py-0.5 text-primary text-xs'>
                            {t(`shelves.items.${itemKey}.tag`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className='mt-5 text-muted-foreground text-xs'>
                      {t(`shelves.${key}.total`)}
                      {t('updatedSuffix')}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className='mt-6 flex items-center justify-center gap-3'>
          <button
            type='button'
            onClick={prev}
            aria-label={t('prevAria')}
            className='flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background transition hover:border-primary hover:text-primary'
          >
            <ArrowLeft className='w-5 h-5' />
          </button>
          <button
            type='button'
            onClick={next}
            aria-label={t('nextAria')}
            className='flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background transition hover:border-primary hover:text-primary'
          >
            <ArrowRight className='h-5 w-5' />
          </button>
        </div>
      </div>
    </section>
  )
}
