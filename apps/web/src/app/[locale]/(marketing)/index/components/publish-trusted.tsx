'use client'

import { Button } from '@workspace/ui/components/button'
import type { LucideIcon } from 'lucide-react'
import { BadgeCheck, Building2, Coins, Fingerprint, ShieldCheck, Upload, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

type TabKey = 'personal' | 'enterprise'

const tabs: Record<TabKey, { icon: LucideIcon; href: string }> = {
  personal: { icon: UserRound, href: Routes.SkillSubmit },
  enterprise: { icon: Building2, href: Routes.ProviderOnboarding },
}

const tabOrder: TabKey[] = ['personal', 'enterprise']
const stepKeys = ['s1', 's2', 's3', 's4'] as const

const trustCards: { icon: LucideIcon; key: string }[] = [
  { icon: BadgeCheck, key: 'credentials' },
  { icon: ShieldCheck, key: 'security' },
  { icon: Fingerprint, key: 'fingerprint' },
  { icon: Coins, key: 'settlement' },
]

export function PublishTrusted() {
  const t = useTranslations('HomePage.publish')
  const [tab, setTab] = useState<TabKey>('personal')

  return (
    <section className='py-section'>
      <div className='mx-auto w-full max-w-page px-gutter sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='grid gap-14 lg:grid-cols-2'>
          <div className='lg:sticky lg:top-24 lg:self-start'>
            <span className='mb-5 inline-block rounded-full border border-border bg-muted/40 px-3 py-1 font-medium text-muted-foreground text-xs'>
              {t('eyebrow')}
            </span>
            <h2 className='mb-5 text-balance font-medium text-title tracking-tight'>{t('title')}</h2>
            <p className='mb-8 text-pretty text-muted-foreground leading-relaxed'>{t('subtitle')}</p>

            <div className='mb-8 inline-flex rounded-full border border-border bg-muted/40 p-1'>
              {tabOrder.map((key) => {
                const { icon: Icon } = tabs[key]
                const isActive = tab === key
                return (
                  <button
                    key={key}
                    type='button'
                    onClick={() => setTab(key)}
                    aria-pressed={isActive}
                    className={`flex items-center gap-2 rounded-full px-5 py-2 font-medium text-sm transition ${
                      isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className='h-4 w-4' />
                    {t(`tabs.${key}`)}
                  </button>
                )
              })}
            </div>

            <ol className='mb-8 space-y-6'>
              {stepKeys.map((stepKey, i) => (
                <li key={stepKey} className='relative flex gap-5'>
                  <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/20 bg-background font-medium text-sm'>
                    {i + 1}
                  </div>
                  <div>
                    <h3 className='mb-1 font-medium'>{t(`${tab}.${stepKey}.title`)}</h3>
                    <p className='text-pretty text-muted-foreground text-sm'>
                      {t(`${tab}.${stepKey}.description`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <Button
              size='lg'
              className='h-12 bg-primary px-8 text-base text-primary-foreground hover:bg-primary/90'
              asChild
            >
              <LocaleLink href={tabs[tab].href}>
                {t(`cta${tab === 'personal' ? 'Personal' : 'Enterprise'}`)}
                <Upload className='ml-2 h-5 w-5' />
              </LocaleLink>
            </Button>
          </div>

          <div className='space-y-4'>
            {trustCards.map(({ icon: Icon, key }) => (
              <div
                key={key}
                className='flex items-start gap-5 rounded-2xl border border-border bg-card p-6 transition hover:border-primary/50'
              >
                <div className='w-fit shrink-0 rounded-lg bg-primary/10 p-3 text-primary'>
                  <Icon className='h-5 w-5' />
                </div>
                <div>
                  <h3 className='mb-1 font-medium'>{t(`cards.${key}.title`)}</h3>
                  <p className='text-pretty text-muted-foreground text-sm'>{t(`cards.${key}.description`)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
