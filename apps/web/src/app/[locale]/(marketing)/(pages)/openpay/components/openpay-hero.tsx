import { Button } from '@workspace/ui/components/button'
import { ArrowDown, BadgeDollarSign, ShieldCheck, Smartphone, Zap } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

const highlights = [
  { icon: Smartphone, key: 'channels' },
  { icon: Zap, key: 'billing' },
  { icon: ShieldCheck, key: 'inflow' },
] as const

export async function OpenpayHero() {
  const t = await getTranslations('OpenPayPage.hero')

  return (
    <section className='relative overflow-hidden border-border border-b px-gutter py-section'>
      <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--color-glow),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,var(--color-glow-dark),transparent_70%)]' />

      <div className='relative mx-auto max-w-4xl text-center'>
        <div className='mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5'>
          <BadgeDollarSign className='size-4 text-primary' />
          <span className='font-medium text-primary text-xs tracking-wide'>{t('eyebrow')}</span>
        </div>

        <h1 className='mb-6 text-balance font-bold text-display text-foreground tracking-tight'>
          {t('titleLine1')}
          <br />
          <span className='text-primary'>{t('titleLine2')}</span>
        </h1>

        <p className='mx-auto mb-8 max-w-2xl text-pretty text-lead text-muted-foreground md:text-xl'>
          {t('subtitle')}
        </p>

        <div className='mx-auto mb-10 flex flex-col items-center justify-center gap-4 sm:flex-row'>
          <Button size='lg' className='h-12 bg-primary px-8 text-base text-primary-foreground' asChild>
            <LocaleLink href={Routes.ProviderOnboarding}>
              {t('ctaPrimary')}
              <ArrowDown className='ml-2 size-4' />
            </LocaleLink>
          </Button>
          <Button size='lg' variant='outline' className='h-12 px-8 text-base' asChild>
            <LocaleLink href='#steps'>{t('ctaSecondary')}</LocaleLink>
          </Button>
        </div>

        <ul className='mx-auto flex max-w-2xl flex-col items-center justify-center gap-4 sm:flex-row'>
          {highlights.map(({ icon: Icon, key }) => (
            <li key={key} className='flex items-center gap-2 text-muted-foreground text-sm'>
              <Icon className='size-4 text-primary' />
              {t(`highlights.${key}`)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
