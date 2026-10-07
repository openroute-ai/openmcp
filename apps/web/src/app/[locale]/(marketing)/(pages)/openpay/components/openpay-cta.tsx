import { Button } from '@workspace/ui/components/button'
import { ArrowRight, BadgeDollarSign } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

export async function OpenpayCta() {
  const t = await getTranslations('OpenPayPage.cta')

  return (
    <section className='px-5 py-16 sm:px-6 md:py-18 lg:px-10'>
      <div className='mx-auto max-w-4xl'>
        <div className='rounded-2xl border border-primary/30 bg-primary/5 px-8 py-16 text-center'>
          <BadgeDollarSign className='mx-auto mb-6 size-12 text-primary' />
          <h2 className='mb-4 text-balance font-medium text-foreground text-subtitle tracking-tight md:text-4xl'>
            {t('title')}
          </h2>
          <p className='mx-auto mb-8 max-w-2xl text-pretty text-lead text-muted-foreground'>{t('subtitle')}</p>
          <div className='flex flex-col items-center justify-center gap-4 sm:flex-row'>
            <Button size='lg' className='h-12 bg-primary px-8 text-base text-primary-foreground' asChild>
              <LocaleLink href={Routes.ProviderOnboarding}>
                {t('ctaPrimary')}
                <ArrowRight className='ml-2 size-4' />
              </LocaleLink>
            </Button>
            <Button size='lg' variant='outline' className='h-12 px-8 text-base' asChild>
              <LocaleLink href={Routes.Skills}>{t('ctaSecondary')}</LocaleLink>
            </Button>
          </div>
          <p className='mt-6 text-muted-foreground text-xs'>{t('note')}</p>
        </div>
      </div>
    </section>
  )
}
