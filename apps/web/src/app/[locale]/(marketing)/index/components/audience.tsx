import { Button } from '@workspace/ui/components/button'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Terminal, Upload } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

interface RoleDef {
  icon: LucideIcon
  key: 'consumer' | 'provider'
  primary: string
  secondary: { labelKey: string; href: string }[]
}

const roles: RoleDef[] = [
  {
    icon: Terminal,
    key: 'consumer',
    primary: 'primary',
    secondary: [
      { labelKey: 'secondaryMcp', href: Routes.MCP },
      { labelKey: 'secondaryA2a', href: Routes.A2A },
    ],
  },
  {
    icon: Upload,
    key: 'provider',
    primary: 'primary',
    secondary: [{ labelKey: 'secondaryProvider', href: Routes.ProviderOnboarding }],
  },
]

const STEP_KEYS = ['s1', 's2', 's3'] as const

export async function Audience() {
  const t = await getTranslations('HomePage.audience')

  return (
    <section className='py-18'>
      <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
        <div className='mx-auto mb-14 max-w-3xl text-center'>
          <span className='mb-4 inline-block rounded-full border border-border bg-muted/40 px-3 py-1 font-medium text-muted-foreground text-xs'>
            {t('eyebrow')}
          </span>
          <h2 className='mb-5 text-balance font-medium text-foreground text-5xl tracking-tight'>
            {t('title')}
          </h2>
          <p className='text-pretty text-muted-foreground leading-relaxed'>{t('subtitle')}</p>
        </div>

        <div className='grid gap-6 lg:grid-cols-2'>
          {roles.map(({ icon: Icon, key, primary, secondary }) => (
            <div key={key} className='flex flex-col rounded-2xl border border-border bg-card p-8'>
              <div className='mb-6 flex items-center gap-3'>
                <div className='w-fit rounded-lg bg-primary/10 p-3 text-primary'>
                  <Icon className='h-5 w-5' />
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>{t(`${key}.eyebrowLabel`)}</p>
                  <h3 className='font-medium text-xl'>{t(`${key}.title`)}</h3>
                </div>
              </div>

              <ol className='mb-8 space-y-5'>
                {STEP_KEYS.map((stepKey, i) => (
                  <li key={stepKey} className='relative flex gap-4'>
                    <div className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-foreground/20 font-medium text-sm'>
                      {i + 1}
                    </div>
                    <p className='text-pretty pt-0.5 text-muted-foreground leading-relaxed'>
                      {t(`${key}.steps.${stepKey}`)}
                    </p>
                  </li>
                ))}
              </ol>

              <div className='mt-auto flex flex-wrap items-center gap-4'>
                <Button
                  size='lg'
                  className='bg-primary px-6 text-base text-primary-foreground hover:bg-primary/90'
                  asChild
                >
                  <LocaleLink href={key === 'provider' ? Routes.SkillSubmit : Routes.Skills}>
                    {t(`${key}.${primary}`)}
                    <ArrowRight className='ml-2 h-4 w-4' />
                  </LocaleLink>
                </Button>
                {secondary.map((item) => (
                  <LocaleLink
                    key={item.href}
                    href={item.href}
                    className='inline-flex items-center gap-1 font-medium text-primary underline-offset-4 transition hover:underline'
                  >
                    {t(`${key}.${item.labelKey}`)}
                    <ArrowRight className='h-4 w-4' />
                  </LocaleLink>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
