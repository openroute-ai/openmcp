import { Button } from '@workspace/ui/components/button'
import { ArrowRight, BadgeCheck, TrendingUp } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleLink } from '@/i18n/navigation'
import { chartColor } from '@/lib/chart-colors'
import { Routes } from '@/lib/routes'

const BARS = [38, 62, 45, 78, 58, 92, 70]

export async function RevenueCta() {
  const t = await getTranslations('HomePage.revenue')

  return (
    <section className='py-16 md:py-18'>
      <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
        <div className='grid items-center gap-12 rounded-[24px] border border-border bg-muted/50 p-8 md:p-14 lg:grid-cols-2'>
          <div>
            <span className='mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 font-medium text-muted-foreground text-xs'>
              <BadgeCheck className='h-3.5 w-3.5 text-primary' />
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
                <LocaleLink href={Routes.ProviderOnboarding}>
                  {t('ctaProvider')}
                  <ArrowRight className='ml-2 h-5 w-5' />
                </LocaleLink>
              </Button>
              <Button size='lg' variant='outline' className='h-12 px-8 text-base' asChild>
                <LocaleLink href={Routes.Skills}>{t('ctaBrowse')}</LocaleLink>
              </Button>
            </div>
          </div>

          <div className='rounded-2xl border border-border bg-card p-6'>
            <div className='mb-6 flex items-center justify-between'>
              <div>
                <p className='text-muted-foreground text-sm'>{t('chartLabel')}</p>
                <p className='font-semibold text-2xl tracking-tight'>{t('chartValue')}</p>
              </div>
              <span className='inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-primary text-xs'>
                <TrendingUp className='h-3 w-3' />
                {t('chartBadge')}
              </span>
            </div>
            <div className='mb-6 flex h-24 items-end gap-2'>
              {BARS.map((height, i) => (
                <div
                  key={i}
                  className='flex-1 rounded-t-md'
                  style={{ height: `${height}%`, backgroundColor: chartColor(i) }}
                />
              ))}
            </div>
            <div className='flex items-center justify-between border-border border-t pt-4'>
              <div>
                <p className='text-muted-foreground text-sm'>{t('earningsLabel')}</p>
                <p className='font-semibold text-primary text-xl tracking-tight'>{t('earningsValue')}</p>
              </div>
              <span className='text-muted-foreground text-xs'>{t('earningsNote')}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
