'use client'

import { Button } from '@workspace/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { ArrowRight, MessageSquareText, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

const steps = [
  { key: 'verify' },
  { key: 'package' },
  { key: 'launch' },
] as const

export function OpenpaySteps() {
  const t = useTranslations('OpenPayPage.steps')

  return (
    <section id='steps' className='border-border border-y bg-muted/40 px-gutter py-section sm:px-gutter-sm lg:px-gutter-lg'>
      <div className='mx-auto max-w-5xl'>
        <div className='mb-12 text-center'>
          <span className='mb-4 inline-block rounded-full border border-border bg-background px-3 py-1 font-medium text-muted-foreground text-xs'>
            {t('eyebrow')}
          </span>
          <h2 className='text-balance font-medium text-foreground text-subtitle tracking-tight md:text-4xl'>
            {t('title')}
          </h2>
        </div>

        <div className='mb-10 flex justify-center'>
          <Tabs defaultValue='wechat'>
            <TabsList>
              <TabsTrigger value='wechat'>{t('tabWechat')}</TabsTrigger>
              <TabsTrigger value='alipay'>{t('tabAlipay')}</TabsTrigger>
            </TabsList>
            <TabsContent value='wechat' className='mt-4 text-balance px-4 text-center text-muted-foreground text-sm'>
              {t('contentWechat')}
            </TabsContent>
            <TabsContent value='alipay' className='mt-4 text-balance px-4 text-center text-muted-foreground text-sm'>
              {t('contentAlipay')}
            </TabsContent>
          </Tabs>
        </div>

        <ol className='mx-auto mb-12 grid max-w-4xl gap-6 md:grid-cols-3'>
          {steps.map(({ key }, i) => (
            <li key={key} className='rounded-2xl border border-border bg-card p-8'>
              <span className='mb-4 flex h-8 w-8 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-sm'>
                {i + 1}
              </span>
              <h3 className='mb-2 font-medium'>{t(`items.${key}.title`)}</h3>
              <p className='text-pretty text-muted-foreground text-sm leading-relaxed'>
                {t(`items.${key}.description`)}
              </p>
            </li>
          ))}
        </ol>

        <div className='flex flex-col items-center justify-center gap-4 sm:flex-row'>
          <Button size='lg' className='h-12 bg-primary px-8 text-base text-primary-foreground' asChild>
            <LocaleLink href={Routes.ProviderOnboarding}>
              {t('ctaPrimary')}
              <ArrowRight className='ml-2 size-4' />
            </LocaleLink>
          </Button>
          <Button size='lg' variant='outline' className='h-12 px-8 text-base' asChild>
            <LocaleLink href={Routes.SkillSubmit}>
              <Sparkles className='mr-2 size-4' />
              {t('ctaSecondary')}
            </LocaleLink>
          </Button>
          <span className='text-muted-foreground text-sm'>
            <MessageSquareText className='mr-1 inline size-4' />
            {t('support')}
          </span>
        </div>
      </div>
    </section>
  )
}
