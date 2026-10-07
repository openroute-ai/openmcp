import { Button } from '@workspace/ui/components/button'
import { ArrowRight, BadgeDollarSign, Check, CircleCheck } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

const ORDER_KEYS = ['earnings', 'stocks', 'meeting'] as const

export async function OpenpayHomeCta() {
  const t = await getTranslations('HomePage.openpay')

  return (
    <section className='py-16 md:py-18'>
      <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
        <div className='grid items-center gap-12 overflow-hidden rounded-[24px] border border-border bg-muted/40 p-8 md:p-14 lg:grid-cols-2'>
          <div>
            <span className='mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 font-medium text-muted-foreground text-xs'>
              <BadgeDollarSign className='h-3.5 w-3.5 text-primary' />
              {t('eyebrow')}
            </span>
            <h2 className='mb-5 text-balance font-medium text-5xl tracking-tight'>
              {t('title')}
              <br />
              {t('titleBreak')}
            </h2>
            <p className='mb-8 max-w-md text-pretty text-muted-foreground leading-relaxed'>{t('subtitle')}</p>
            <div className='flex flex-wrap gap-3'>
              <Button
                size='lg'
                className='h-12 bg-primary px-8 text-base text-primary-foreground hover:bg-primary/90'
                asChild
              >
                <LocaleLink href={Routes.Skills}>
                  {t('ctaBrowse')}
                  <ArrowRight className='ml-2 h-5 w-5' />
                </LocaleLink>
              </Button>
              <Button size='lg' variant='outline' className='h-12 px-8 text-base' asChild>
                <LocaleLink href={Routes.OpenPay}>{t('ctaLearn')}</LocaleLink>
              </Button>
            </div>
          </div>

          <div className='rounded-2xl border border-border bg-card p-6'>
            <div className='mb-5 flex items-center justify-between'>
              <div>
                <p className='text-muted-foreground text-sm'>{t('panelLabel')}</p>
                <p className='font-semibold text-2xl tracking-tight'>{t('panelValue')}</p>
              </div>
              <span className='inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-primary text-xs'>
                <Check className='h-3 w-3' />
                {t('panelBadge')}
              </span>
            </div>
            <div className='space-y-3'>
              {ORDER_KEYS.map((key) => (
                <div
                  key={key}
                  className='flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3'
                >
                  <span className='flex items-center gap-2 text-sm'>
                    <CircleCheck className='h-4 w-4 text-primary' />
                    {t(`lines.${key}.label`)}
                  </span>
                  <span className='font-semibold text-primary text-sm'>{t(`lines.${key}.amount`)}</span>
                </div>
              ))}
            </div>
            <div className='mt-5 flex items-center justify-between border-border border-t pt-4 text-muted-foreground text-xs'>
              <span>{t('footerLeft')}</span>
              <span>{t('footerRight')}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
