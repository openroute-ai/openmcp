'use client'

import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bot,
  Plug,
  Puzzle,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { LocaleLink } from '@/i18n/navigation'
import { A2A_LINK, MCP_LINK, SKILLS_LINK } from '@/lib/marketing/cta'
import { RUNTIMES_TEXT } from '@/lib/marketing/runtimes'
import { SectionHeading } from './section-heading'

type ShelfKey = 'skills' | 'mcp' | 'a2a'

interface Shelf {
  icon: LucideIcon
  key: ShelfKey
  protocol: string
  href: string
  cta: string
}

const itemKeys = [1, 2, 3] as const

/** 目录规模数字全站只在 total 出现一次，不再另设 Metrics 段落重复 */
const shelves: Shelf[] = [
  {
    icon: Puzzle,
    key: 'skills',
    protocol: 'SKILL.md',
    href: SKILLS_LINK.href,
    cta: 'skills',
  },
  { icon: Plug, key: 'mcp', protocol: 'MCP', href: MCP_LINK.href, cta: 'mcp' },
  { icon: Bot, key: 'a2a', protocol: 'A2A', href: A2A_LINK.href, cta: 'a2a' },
]

export function CapabilityCarousel() {
  const t = useTranslations('Landing.carousel')
  const tc = useTranslations('Landing.cta')
  const [index, setIndex] = useState(0)
  const count = shelves.length

  const prev = () => setIndex((i) => (i - 1 + count) % count)
  const next = () => setIndex((i) => (i + 1) % count)

  return (
    <section className="py-18" aria-label={t('ariaLabel')}>
      <div className="mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10">
        <SectionHeading
          align="center"
          eyebrow={t('eyebrow')}
          title={t('title')}
          description={t('subtitle')}
          className="mb-10"
        />

        <div className="overflow-hidden rounded-[20px] bg-muted">
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {shelves.map((shelf) => (
              <div key={shelf.key} className="w-full shrink-0">
                <div className="grid min-h-90 items-center gap-10 p-8 md:grid-cols-2 md:p-12">
                  <div>
                    <div className="mb-5 flex items-center gap-3">
                      <div className="w-fit rounded-lg bg-foreground p-3 text-background">
                        <shelf.icon className="h-5 w-5" />
                      </div>
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                        {shelf.protocol}
                      </span>
                    </div>
                    <h3 className="mb-4 text-subtitle font-medium tracking-tight text-pretty text-foreground">
                      {t(`${shelf.key}.title`)}
                    </h3>
                    <p className="mb-6 leading-relaxed text-pretty text-muted-foreground">
                      {t(`${shelf.key}.description`, {
                        runtimes: RUNTIMES_TEXT,
                      })}
                    </p>
                    <LocaleLink
                      href={shelf.href}
                      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 transition hover:underline"
                    >
                      {tc(shelf.cta)}
                      <ArrowRight className="h-4 w-4" />
                    </LocaleLink>
                  </div>

                  <div className="rounded-2xl border border-border bg-background p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t('sampleLabel')}
                      </span>
                      <BadgeCheck className="h-4 w-4 text-primary" />
                    </div>
                    <ul className="space-y-3">
                      {itemKeys.map((item) => (
                        <li
                          key={item}
                          className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3"
                        >
                          <span className="font-medium text-foreground">
                            {t(`${shelf.key}.items.${item}.name`)}
                          </span>
                          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                            {t(`${shelf.key}.items.${item}.tag`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-5 text-xs text-muted-foreground">
                      {t(`${shelf.key}.total`)}
                      {t('updatedSuffix')}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={prev}
            aria-label={t('prevAria')}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background transition hover:border-primary hover:text-primary"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label={t('nextAria')}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background transition hover:border-primary hover:text-primary"
          >
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </section>
  )
}
