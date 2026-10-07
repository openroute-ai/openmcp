import { Button } from '@workspace/ui/components/button'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Banknote,
  Braces,
  Database,
  Gauge,
  KeyRound,
  Layers,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

interface Capability {
  icon: LucideIcon
  key: string
}

const capabilities: Capability[] = [
  { icon: Layers, key: 'protocol' },
  { icon: Database, key: 'registry' },
  { icon: ShieldCheck, key: 'security' },
  { icon: Gauge, key: 'metering' },
  { icon: KeyRound, key: 'keys' },
  { icon: Banknote, key: 'settlement' },
  { icon: MonitorSmartphone, key: 'runtimes' },
  { icon: Braces, key: 'api' },
]

export async function CapabilityList() {
  const t = await getTranslations('HomePage.capabilities')

  return (
    <section id='features' className='py-18 lg:py-24'>
      <div className='mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10'>
        <div className='mb-12 flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <div className='max-w-2xl'>
            <h2 className='mb-4 text-balance font-medium text-title tracking-tight'>{t('title')}</h2>
            <p className='text-pretty text-lead text-muted-foreground'>{t('subtitle')}</p>
          </div>
          <LocaleLink
            href={Routes.SkillSubmit}
            className='inline-flex shrink-0 items-center gap-1 font-medium text-primary underline-offset-4 transition hover:underline'
          >
            {t('cta')}
            <ArrowRight className='h-4 w-4' />
          </LocaleLink>
        </div>

        <div className='grid gap-6 lg:grid-cols-[0.72fr_1.28fr]'>
          <div className='flex flex-col justify-between rounded-[20px] bg-foreground p-8 text-background md:p-10'>
            <div>
              <span className='inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-medium text-sm'>
                <Sparkles className='h-3.5 w-3.5' />
                {t('revenueBadge')}
              </span>
              <div className='mt-6 font-semibold text-6xl tracking-tight md:text-7xl'>{t('revenueValue')}</div>
              <p className='mt-4 max-w-xs text-pretty text-background/70 leading-relaxed'>
                {t('revenueText')}
              </p>
            </div>
            <div className='mt-8 flex flex-col gap-3 sm:flex-row'>
              <Button size='lg' className='bg-background px-6 text-base text-foreground hover:bg-muted' asChild>
                <LocaleLink href={Routes.SkillSubmit}>
                  {t('ctaSubmitSkill')}
                  <ArrowRight className='ml-2 h-4 w-4' />
                </LocaleLink>
              </Button>
              <Button
                size='lg'
                variant='ghost'
                className='px-6 text-background text-base hover:bg-white/10 hover:text-background'
                asChild
              >
                <LocaleLink href={Routes.ProviderOnboarding}>{t('ctaProviderOnboarding')}</LocaleLink>
              </Button>
            </div>
          </div>

          <div className='grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-2'>
            {capabilities.map(({ icon: Icon, key }, i) => (
              <div
                key={key}
                className='group flex items-center gap-4 bg-card p-5 transition hover:bg-muted/60'
              >
                <span className='shrink-0 font-mono text-muted-foreground text-sm'>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className='w-fit rounded-lg bg-primary/10 p-2.5 text-primary'>
                  <Icon className='h-5 w-5' />
                </div>
                <div className='min-w-0'>
                  <h3 className='font-medium'>{t(`items.${key}.title`)}</h3>
                  <p className='truncate text-muted-foreground text-sm'>{t(`items.${key}.description`)}</p>
                </div>
                <ArrowRight className='ml-auto h-4 w-4 shrink-0 text-border transition group-hover:text-primary' />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
