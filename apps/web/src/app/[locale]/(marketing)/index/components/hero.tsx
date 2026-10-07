import { Button } from '@workspace/ui/components/button'
import { ArrowRight, Store } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { CopyPrompt } from '@/components/copy-prompt'
import { LocaleLink } from '@/i18n/navigation'
import { installPromptFor } from '@/lib/marketing/install-prompt'
import { Routes } from '@/lib/routes'

const INSTALL_PATH = '/install/openmcp.md'
const RUNTIME_BRANDS = ['Cursor', 'Claude Code', 'Codex']

export async function Hero() {
  const [t, locale] = await Promise.all([getTranslations('HomePage.hero'), getLocale()])

  return (
    <section className='relative pt-32 pb-16 md:pt-44 md:pb-24'>
      <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
        <div className='mx-auto max-w-4xl text-center'>
          <div className='mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-4 py-1.5 text-muted-foreground text-sm'>
            <Store className='h-4 w-4 text-primary' />
            <span>
              <b className='text-foreground'>{t('badge')}</b>
              <span className='text-muted-foreground'>{t('badgeSuffix')}</span>
            </span>
          </div>

          <h1 className='mb-6 text-balance font-medium text-6xl text-foreground tracking-tight'>
            {t('titleLead')} <span className='text-primary'>{t('titleHighlight')}</span>
          </h1>

          <p className='mx-auto mb-8 max-w-3xl text-pretty text-xl text-muted-foreground'>
            {t('subtitle')}
          </p>

          <div className='mb-6 flex flex-wrap items-center justify-center gap-3'>
            <Button size='lg' className='h-12 rounded-full px-7 text-base' asChild>
              <LocaleLink href={Routes.Skills}>
                {t('ctaBrowse')}
                <ArrowRight className='ml-2 h-4 w-4' />
              </LocaleLink>
            </Button>
            <Button size='lg' variant='outline' className='h-12 rounded-full px-7 text-base' asChild>
              <LocaleLink href={Routes.ProviderOnboarding}>{t('ctaPublish')}</LocaleLink>
            </Button>
          </div>

          <div className='mx-auto flex max-w-2xl flex-col items-stretch gap-3 rounded-2xl border border-border bg-background p-3 shadow-sm sm:flex-row sm:items-center sm:rounded-full sm:pl-5'>
            <p className='min-w-0 flex-1 truncate text-left text-muted-foreground text-sm'>
              {t('installLead')} <code className='text-foreground'>{INSTALL_PATH}</code>{' '}
              {t('installTrail')}
            </p>
            <CopyPrompt
              text={installPromptFor(locale)}
              label={t('copyPrompt')}
              className='bg-foreground text-background hover:bg-primary'
            />
          </div>

          <p className='mt-3 text-muted-foreground text-xs'>
            {t('stepsLead')}{' '}
            <LocaleLink href={Routes.Start} className='text-primary underline-offset-4 hover:underline'>
              /start
            </LocaleLink>{' '}
            ·{' '}
            <a href={INSTALL_PATH} className='text-primary underline-offset-4 hover:underline'>
              install/openmcp.md
            </a>
          </p>

          <div className='mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-muted-foreground text-sm'>
            {[...RUNTIME_BRANDS, t('runtimes.agent')].map((runtime, i) => (
              <span key={runtime} className='inline-flex items-center gap-3'>
                {i > 0 && (
                  <span aria-hidden className='text-border'>
                    ·
                  </span>
                )}
                {runtime}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
