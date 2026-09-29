import { Button } from '@workspace/ui/components/button'
import { ArrowRight, Rocket } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

export async function Onboarding() {
  const t = await getTranslations('HomePage.onboarding')

  return (
    <section id='onboarding' className='py-section'>
      <div className='mx-auto w-full max-w-page px-gutter sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='relative overflow-hidden rounded-[24px] bg-foreground px-8 py-16 text-center text-background md:px-16 md:py-section'>
          <div
            aria-hidden
            className='pointer-events-none absolute inset-0 opacity-20'
            style={{
              backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          />
          <div
            aria-hidden
            className='absolute top-6 right-6 rotate-6 rounded-full bg-background px-4 py-1.5 font-medium text-foreground text-sm'
          >
            {t('corner')}
          </div>

          <div className='relative'>
            <span className='mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm'>
              <Rocket className='h-4 w-4' />
              {t('eyebrow')}
            </span>
            <h2 className='mx-auto mb-5 max-w-2xl text-balance font-medium text-background text-title tracking-tight'>
              {t('title')}
            </h2>
            <p className='mx-auto mb-10 max-w-2xl text-pretty text-background/80 leading-relaxed'>
              {t('subtitle')}
            </p>
            <div className='flex flex-col items-center justify-center gap-4 sm:flex-row'>
              <Button size='lg' className='bg-background px-8 text-base text-foreground hover:bg-muted' asChild>
                <LocaleLink href={Routes.Skills}>
                  {t('ctaBrowse')}
                  <ArrowRight className='ml-2 h-5 w-5' />
                </LocaleLink>
              </Button>
              <Button
                size='lg'
                variant='ghost'
                className='bg-white/10 px-8 text-background text-base hover:bg-white/20 hover:text-background'
                asChild
              >
                <LocaleLink href={Routes.ProviderOnboarding}>{t('ctaProvider')}</LocaleLink>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
