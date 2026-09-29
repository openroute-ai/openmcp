'use client'

import {
  BadgeCheck,
  CircleCheckBig,
  CreditCard,
  Send,
  UserRound,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

const STEPS = [
  { icon: UserRound, key: 'account' },
  { icon: BadgeCheck, key: 'onboard' },
  { icon: CreditCard, key: 'payout' },
  { icon: CircleCheckBig, key: 'publish' },
] as const

const BENEFITS = ['shelves', 'pricing', 'revenue', 'review'] as const

/**
 * Marketing panel shown to signed-out visitors on the onboarding and publish
 * pages. The primary action is a real link to the sign-in page so it stays
 * keyboard accessible and renders without JavaScript.
 */
export function ProviderNotLogin() {
  const t = useTranslations('ProviderPage.notLogin')
  const signInHref = `${Routes.Login}?callbackUrl=${encodeURIComponent(Routes.ProviderOnboarding)}`

  return (
    <div className='mx-auto max-w-4xl space-y-12'>
      <div className='flex flex-col items-center gap-4 text-center'>
        <h2 className='font-mono font-semibold uppercase tracking-wider text-gradient_indigo-purple'>
          {t('eyebrow')}
        </h2>
        <p className='text-balance text-2xl text-foreground'>{t('headline')}</p>
        <p className='text-balance text-lg text-muted-foreground'>{t('subheadline')}</p>
      </div>

      <div className='grid grid-cols-1 gap-6 md:grid-cols-4'>
        {STEPS.map(({ icon: Icon, key }) => (
          <div key={key} className='flex flex-col items-center space-y-3 text-center'>
            <div className='flex h-12 w-12 items-center justify-center rounded-full bg-primary/10'>
              <Icon className='size-6 text-primary' />
            </div>
            <h3 className='font-medium'>{t(`steps.${key}.title`)}</h3>
            <p className='text-muted-foreground text-sm'>{t(`steps.${key}.description`)}</p>
          </div>
        ))}
      </div>

      <div className='rounded-lg bg-muted/50 p-6'>
        <h3 className='mb-4 font-semibold text-lg'>{t('whyTitle')}</h3>
        <div className='grid grid-cols-1 gap-4 text-sm md:grid-cols-2'>
          {BENEFITS.map((key) => (
            <div key={key} className='flex items-start gap-2'>
              <CircleCheckBig className='mt-0.5 size-4 shrink-0 text-green-600' />
              <span>{t(`benefits.${key}`)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className='py-12 text-center'>
        <div className='mx-auto max-w-md space-y-6'>
          <div>
            <h2 className='mb-2 font-bold text-2xl text-foreground'>{t('ctaTitle')}</h2>
            <p className='text-muted-foreground'>{t('ctaHint')}</p>
          </div>
          <div className='space-y-4'>
            <LocaleLink
              href={signInHref}
              className='inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-8 font-medium text-base text-primary-foreground transition-colors hover:bg-primary/90'
            >
              <Send className='mr-2 size-4' />
              {t('ctaButton')}
            </LocaleLink>
            <p className='text-muted-foreground text-xs'>{t('ctaFootnote')}</p>
          </div>
        </div>
      </div>

      <div className='rounded-lg bg-blue-50 p-6 text-sm dark:bg-blue-950/20'>
        <h4 className='mb-2 font-medium text-blue-900 dark:text-blue-200'>{t('enterpriseTitle')}</h4>
        <p className='text-blue-800 dark:text-blue-300'>{t('enterpriseHint')}</p>
      </div>
    </div>
  )
}
