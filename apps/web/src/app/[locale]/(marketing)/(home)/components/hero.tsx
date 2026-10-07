import { Button } from '@workspace/ui/components/button'
import { ArrowRight, Store } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { CopyPrompt } from '@/components/copy-prompt'
import { LocaleLink } from '@/i18n/navigation'
import { MARKET_CTA, PROVIDER_CTA } from '@/lib/marketing/cta'
import { INSTALL_PROMPT } from '@/lib/marketing/install-prompt'
import { RUNTIMES, RUNTIMES_TEXT } from '@/lib/marketing/runtimes'
import { Routes } from '@/lib/routes'

export async function Hero() {
  const t = await getTranslations('Landing.hero')
  const tc = await getTranslations('Landing.cta')

  return (
    <section className="relative pt-20 pb-14 md:pt-28 md:pb-20">
      <div className="mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-4 py-1.5 text-sm text-muted-foreground">
            <Store className="h-4 w-4 text-primary" />
            <span>
              <b className="text-foreground">{t('badge')}</b>
              <span className="text-muted-foreground">{t('badgeSuffix')}</span>
            </span>
          </div>

          <h1 className="mb-6 text-display font-medium tracking-tight text-balance text-foreground">
            {t('titleLead')}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h1>

          <p className="mx-auto mb-8 max-w-3xl text-lead text-pretty text-muted-foreground">
            {t('subtitle')}
          </p>

          <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" className="rounded-full" asChild>
              <LocaleLink href={MARKET_CTA.href}>
                {tc('browse')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </LocaleLink>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-full"
              asChild
            >
              <LocaleLink href={PROVIDER_CTA.href}>{tc('provider')}</LocaleLink>
            </Button>
          </div>

          <div className="mx-auto flex max-w-2xl flex-col items-stretch gap-3 rounded-2xl border border-border bg-background p-3 shadow-sm sm:flex-row sm:items-center sm:rounded-full sm:pl-5">
            <p className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground">
              {t.rich('installPrompt', {
                path: (chunks) => <code className="text-foreground">{chunks}</code>,
              })}
            </p>
            <CopyPrompt
              text={INSTALL_PROMPT}
              label={t('copyPrompt')}
              className="bg-foreground text-background hover:bg-primary"
            />
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            {t('stepsPrefix')}
            <LocaleLink
              href={Routes.Start}
              className="text-primary underline-offset-4 hover:underline"
            >
              /start
            </LocaleLink>
            {' · '}
            <a
              href="/install/openmcp.md"
              className="text-primary underline-offset-4 hover:underline"
            >
              install/openmcp.md
            </a>
          </p>

          <p className="mt-8 text-sm text-pretty text-muted-foreground">
            {t('runtimeCompat', { runtimes: RUNTIMES_TEXT })}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground/70">
            {RUNTIMES.map((runtime, i) => (
              <span key={runtime} className="inline-flex items-center gap-3">
                {i > 0 && (
                  <span aria-hidden className="text-border">
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
